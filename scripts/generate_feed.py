#!/usr/bin/env python3
"""Regenerate the rss.xml RSS feed from episode files."""

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from email.utils import formatdate
from pathlib import Path

import yaml

sys.path.insert(0, os.path.dirname(__file__))
from shared import parse_episode_filename, get_mp3_duration, project_root


def load_podcast_config():
    """Load podcast.yaml configuration."""
    config_path = project_root() / "podcast.yaml"
    if not config_path.exists():
        print("Warning: podcast.yaml not found, using defaults", file=sys.stderr)
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def rfc2822_date(dt):
    """Format datetime as RFC 2822 string."""
    return formatdate(dt.timestamp(), usegmt=True)



def load_manifest(episodes_dir):
    """Load episode metadata from episodes.yaml manifest."""
    manifest_path = os.path.join(episodes_dir, 'episodes.yaml')
    if not os.path.exists(manifest_path):
        return {}
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
        return data.get('episodes', {}) if data else {}
    except Exception as e:
        print(f"Warning: Could not parse episodes.yaml: {e}", file=sys.stderr)
        return {}


def extract_cdata_content(xml_path, guid):
    """Extract CDATA content for a specific item from raw XML text."""
    try:
        with open(xml_path, 'r', encoding='utf-8') as f:
            content = f.read()
        guid_pattern = re.escape(guid)
        item_pattern = rf'<item>.*?<guid[^>]*>{guid_pattern}</guid>.*?</item>'
        match = re.search(item_pattern, content, re.DOTALL)
        if not match:
            return ''
        item_text = match.group(0)
        cdata_match = re.search(
            r'<content:encoded><!\[CDATA\[(.*?)\]\]></content:encoded>',
            item_text, re.DOTALL
        )
        if cdata_match:
            return cdata_match.group(1)
    except Exception:
        pass
    return ''


def load_existing_pubdates(xml_path):
    """Extract existing pubDate values from rss.xml, keyed by guid."""
    dates = {}
    if not os.path.exists(xml_path):
        return dates
    try:
        with open(xml_path, 'r', encoding='utf-8') as f:
            content = f.read()
        for match in re.finditer(
                r'<guid[^>]*>(.*?)</guid>.*?<pubDate>([^<]+)</pubDate>',
                content, re.DOTALL):
            dates[match.group(1)] = match.group(2)
    except Exception:
        pass
    return dates


def backfill_yaml_fields(yaml_path, updates):
    """Surgically insert missing fields (e.g. duration, size) under each
    episode block in episodes.yaml. Preserves comments/formatting by editing
    the raw text rather than dumping through a YAML serializer."""
    if not updates:
        return
    with open(yaml_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        out.append(line)
        m = re.match(r'^(  )(\d+):\s*$', line)
        if not (m and int(m.group(2)) in updates):
            i += 1
            continue
        ep_num = int(m.group(2))
        fields = updates[ep_num]
        body_start = len(out)
        present = set()
        j = i + 1
        while j < len(lines):
            nxt = lines[j]
            if nxt.strip() == '' or nxt.startswith('    '):
                fm = re.match(r'^    (\w+):', nxt)
                if fm:
                    present.add(fm.group(1))
                out.append(nxt)
                j += 1
            else:
                break
        for key, val in fields.items():
            if key not in present:
                out.insert(body_start, f'    {key}: {val}\n')
                body_start += 1
        i = j
    with open(yaml_path, 'w', encoding='utf-8') as f:
        f.writelines(out)


def build_feed(episodes_dir, config):
    """Build the complete RSS feed XML. Episodes.yaml is the source of truth;
    a local mp3 is only needed to first compute duration/size for an episode,
    which are then cached back into the yaml."""
    # Absolute URLs in the feed are filled in by the middleware at serve time
    # so the same artifact works on any hostname (production, preview, dev).
    site_url = '{{SITE_URL}}'
    cover_path = config.get('cover', '/cover.png')
    cover_ext = 'jpg' if cover_path.lower().endswith(('.jpg', '.jpeg')) else 'png'
    xml_path = os.path.join(episodes_dir, 'rss.xml')
    manifest_path = os.path.join(episodes_dir, 'episodes.yaml')
    manifest = load_manifest(episodes_dir)
    existing_pubdates = load_existing_pubdates(xml_path)
    cdata_cache = {}
    for guid in existing_pubdates:
        cdata = extract_cdata_content(xml_path, guid)
        if cdata:
            cdata_cache[guid] = cdata

    labels = config.get('labels', {})
    ep_label = labels.get('episode', 'Episode')
    yaml_backfills = {}
    episodes = []

    for episode_num, ep_meta in sorted(manifest.items(), key=lambda kv: kv[0]):
        season = ep_meta.get('season', 1)
        basename = f"s{season}e{episode_num}"
        mp3_path = Path(episodes_dir) / f"{basename}.mp3"
        srt_path = Path(episodes_dir) / f"{basename}.srt"

        # Duration + size: prefer the local mp3 when present, otherwise use
        # values cached in episodes.yaml. New values are queued for writeback.
        if mp3_path.exists():
            duration_str, _ = get_mp3_duration(str(mp3_path))
            size_bytes = os.path.getsize(mp3_path)
            new_fields = {}
            if 'duration' not in ep_meta:
                new_fields['duration'] = f'"{duration_str}"'
            if 'size' not in ep_meta:
                new_fields['size'] = str(size_bytes)
            if new_fields:
                yaml_backfills[episode_num] = new_fields
        else:
            duration_str = ep_meta.get('duration', '00:00')
            size_bytes = int(ep_meta.get('size', 0))

        guid = ep_meta.get('guid', basename)

        if ep_meta.get('date'):
            pub_date_str = rfc2822_date(datetime.fromisoformat(str(ep_meta['date'])).replace(tzinfo=timezone.utc))
        elif guid in existing_pubdates:
            pub_date_str = existing_pubdates[guid]
        elif mp3_path.exists():
            pub_date_str = rfc2822_date(datetime.fromtimestamp(os.path.getmtime(mp3_path), tz=timezone.utc))
        else:
            pub_date_str = rfc2822_date(datetime.now(tz=timezone.utc))

        raw_title = ep_meta.get('title', '')
        title = raw_title if raw_title else f"{ep_label} {episode_num}"
        description = ep_meta.get('description', '')
        explicit = ep_meta.get('explicit', config.get('explicit', False))

        has_srt = srt_path.exists() or existing_pubdates.get(guid) and guid in cdata_cache
        # Fallback: if the srt file isn't local, honor the existing RSS flag
        # (rss.xml itself carries the podcast:transcript tag when present).
        if not srt_path.exists():
            has_srt = bool(re.search(rf'<guid[^>]*>{re.escape(guid)}</guid>[\s\S]*?<podcast:transcript',
                                     open(xml_path).read())) if os.path.exists(xml_path) else False

        episodes.append({
            'season': season,
            'episode_num': episode_num,
            'basename': basename,
            'title': title,
            'description': description,
            'explicit': explicit,
            'guid': guid,
            'pub_date': pub_date_str,
            'duration_str': duration_str,
            'size_bytes': size_bytes,
            'link': f"{site_url}/{episode_num}",
            'enclosure_url': f"{site_url}/{basename}.mp3",
            'transcript_url': f"{site_url}/{basename}.srt",
            'image_url': f"{site_url}/{basename}.{cover_ext}",
            'cdata_content': cdata_cache.get(guid, ''),
            'has_srt': has_srt,
            'apple_id': ep_meta.get('apple_id'),
            'youtube_id': ep_meta.get('youtube_id'),
            'spotify_id': ep_meta.get('spotify_id'),
            'amazon_id': ep_meta.get('amazon_id'),
        })

    if yaml_backfills:
        backfill_yaml_fields(manifest_path, yaml_backfills)
        print(f"Wrote duration/size for {len(yaml_backfills)} episode(s) to {manifest_path}", file=sys.stderr)

    mp3_files = list(Path(episodes_dir).glob('s*e*.mp3'))

    all_times = []
    for mp3_path in mp3_files:
        all_times.append(os.path.getmtime(mp3_path))
        srt_path = mp3_path.with_suffix('.srt')
        if srt_path.exists():
            all_times.append(os.path.getmtime(srt_path))
    last_build = rfc2822_date(
        datetime.fromtimestamp(max(all_times), tz=timezone.utc)) if all_times else rfc2822_date(
        datetime.now(tz=timezone.utc))

    return episodes, last_build


def write_feed(episodes_dir, episodes, last_build, config):
    """Write the RSS feed XML file with CDATA sections."""
    # Absolute URLs in the feed are filled in by the middleware at serve time
    # so the same artifact works on any hostname (production, preview, dev).
    site_url = '{{SITE_URL}}'
    xml_path = os.path.join(episodes_dir, 'rss.xml')
    language = config.get('language', 'en')
    author = config.get('author', '')
    title = config.get('title', '')
    description = config.get('description', '')
    owner_email = config.get('owner_email', '')
    podcast_guid = config.get('podcast_guid', '')
    itunes_type = config.get('itunes_type', 'episodic')
    explicit_default = config.get('explicit', False)

    cover_path = config.get('cover', '/cover.png')
    cover_url = cover_path if cover_path.startswith('http') else f"{site_url}{cover_path}"

    lines = []
    lines.append("<?xml version='1.0' encoding='UTF-8'?>")
    lines.append('<rss xmlns:atom="http://www.w3.org/2005/Atom" '
                 'xmlns:content="http://purl.org/rss/1.0/modules/content/" '
                 'xmlns:dc="http://purl.org/dc/elements/1.1/" '
                 'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" '
                 'xmlns:podcast="https://podcastindex.org/namespace/1.0" '
                 'version="2.0">')
    lines.append('  <channel>')
    lines.append(f'    <title>{escape_xml(title)}</title>')
    lines.append(f'    <description>{escape_xml(description)}</description>')
    lines.append(f'    <link>{site_url}</link>')
    lines.append('    <image>')
    lines.append(f'      <url>{cover_url}</url>')
    lines.append(f'      <title>{escape_xml(title)}</title>')
    lines.append(f'      <link>{site_url}</link>')
    lines.append('    </image>')
    lines.append('    <generator>coil — https://github.com/mluggy/coil</generator>')
    lines.append(f'    <lastBuildDate>{last_build}</lastBuildDate>')
    lines.append(f'    <atom:link href="{site_url}/rss.xml" rel="self" type="application/rss+xml" />')
    lines.append(f'    <copyright>{escape_xml(config.get("copyright", author))}</copyright>')
    lines.append(f'    <language>{language}</language>')
    lines.append(f'    <itunes:author>{escape_xml(author)}</itunes:author>')
    lines.append(f'    <itunes:summary>{escape_xml(title)}</itunes:summary>')
    lines.append(f'    <itunes:type>{itunes_type}</itunes:type>')
    lines.append('    <itunes:owner>')
    lines.append(f'      <itunes:name>{escape_xml(author)}</itunes:name>')
    lines.append(f'      <itunes:email>{escape_xml(owner_email)}</itunes:email>')
    lines.append('    </itunes:owner>')
    lines.append(f'    <itunes:explicit>{"yes" if explicit_default else "no"}</itunes:explicit>')

    for cat in config.get('itunes_categories', []):
        if isinstance(cat, dict):
            parent, sub = next(iter(cat.items()))
        elif isinstance(cat, str) and ': ' in cat:
            parent, sub = cat.split(': ', 1)
        else:
            parent, sub = (cat if isinstance(cat, str) else str(cat)), None
        if sub:
            lines.append(f'    <itunes:category text="{escape_xml(parent)}">')
            lines.append(f'      <itunes:category text="{escape_xml(sub)}" />')
            lines.append('    </itunes:category>')
        else:
            lines.append(f'    <itunes:category text="{escape_xml(parent)}" />')

    lines.append(f'    <itunes:image href="{cover_url}" />')
    if podcast_guid:
        lines.append(f'    <podcast:guid>{escape_xml(podcast_guid)}</podcast:guid>')
    if owner_email:
        lines.append(f'    <podcast:locked owner="{escape_xml(owner_email)}">yes</podcast:locked>')
    lines.append('    <podcast:medium>podcast</podcast:medium>')

    funding_url = config.get('funding_url', '')
    funding_text = config.get('labels', {}).get('funding', '')
    if funding_url:
        lines.append(f'    <podcast:funding url="{escape_xml(funding_url)}">{escape_xml(funding_text)}</podcast:funding>')

    publisher = config.get('publisher', '') or author
    if publisher:
        lines.append(f'    <podcast:publisher>{escape_xml(publisher)}</podcast:publisher>')

    update_frequency = config.get('update_frequency', '')
    if update_frequency:
        lines.append(f'    <podcast:updateFrequency>{escape_xml(update_frequency)}</podcast:updateFrequency>')

    podcast_license = config.get('license', '')
    if podcast_license:
        lines.append(f'    <podcast:license>{escape_xml(podcast_license)}</podcast:license>')

    x_username = config.get('x_username', '')
    if x_username and author:
        x_url = f'https://x.com/{x_username}'
        lines.append(f'    <podcast:person role="host" href="{escape_xml(x_url)}">{escape_xml(author)}</podcast:person>')

    for ep in episodes:
        lines.append('    <item>')
        lines.append(f'      <title>{escape_xml(ep["title"])}</title>')
        lines.append(f'      <description>{escape_xml(ep["description"])}</description>')
        lines.append(f'      <link>{ep["link"]}</link>')
        lines.append(f'      <guid isPermaLink="false">{ep["guid"]}</guid>')
        lines.append(f'      <pubDate>{ep["pub_date"]}</pubDate>')
        lines.append(f'      <enclosure url="{ep["enclosure_url"]}" length="{ep["size_bytes"]}" type="audio/mpeg" />')
        lines.append(f'      <itunes:summary>{escape_xml(ep["description"])}</itunes:summary>')
        explicit_str = 'yes' if ep.get('explicit') else 'no'
        lines.append(f'      <itunes:explicit>{explicit_str}</itunes:explicit>')
        lines.append(f'      <itunes:duration>{ep["duration_str"]}</itunes:duration>')
        lines.append(f'      <itunes:image href="{ep["image_url"]}" />')
        lines.append(f'      <itunes:season>{ep["season"]}</itunes:season>')
        lines.append(f'      <itunes:episode>{ep["episode_num"]}</itunes:episode>')
        lines.append('      <itunes:episodeType>full</itunes:episodeType>')
        if author:
            lines.append(f'      <dc:creator>{escape_xml(author)}</dc:creator>')
        if ep['has_srt']:
            lines.append(f'      <podcast:transcript url="{ep["transcript_url"]}" type="application/x-subrip" rel="captions" language="{language}" />')
        if ep['cdata_content']:
            lines.append(f'      <content:encoded><![CDATA[{ep["cdata_content"]}]]></content:encoded>')
        lines.append('    </item>')

    lines.append('  </channel>')
    lines.append('</rss>')

    rss_content = '\n'.join(lines) + '\n'
    with open(xml_path, 'w', encoding='utf-8') as f:
        f.write(rss_content)

    print(f"Generated {xml_path} with {len(episodes)} episodes", file=sys.stderr)


def escape_xml(text):
    """Escape XML special characters."""
    if not text:
        return ''
    return (str(text)
            .replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&apos;'))


def main():
    parser = argparse.ArgumentParser(description='Generate podcast RSS feed')
    parser.add_argument('episodes_dir', help='Path to episodes directory')
    args = parser.parse_args()

    if not os.path.isdir(args.episodes_dir):
        print(f"Error: {args.episodes_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    config = load_podcast_config()
    episodes, last_build = build_feed(args.episodes_dir, config)
    write_feed(args.episodes_dir, episodes, last_build, config)


if __name__ == '__main__':
    main()
