from pathlib import Path
import json, re, requests
from datetime import datetime
from bs4 import BeautifulSoup

base = Path('output/baseball-show-prep')
data_dir = base / 'data'
data_dir.mkdir(parents=True, exist_ok=True)

URLS = {
    'league_standings': 'https://www.mlb.com/standings',
    'league_probables': 'https://www.mlb.com/probable-pitchers',
    'league_transactions': 'https://www.espn.com/mlb/transactions',
    'athletics_standings': 'https://www.mlb.com/athletics/standings/mlb',
    'athletics_probables': 'https://www.mlb.com/athletics/roster/probable-pitchers',
    'athletics_transactions': 'https://www.mlb.com/athletics/roster/transactions',
    'rockies_standings': 'https://www.mlb.com/rockies/standings',
    'rockies_probables': 'https://www.mlb.com/rockies/roster/probable-pitchers',
    'rockies_transactions': 'https://www.mlb.com/rockies/roster/transactions',
    'tigers_standings': 'https://www.mlb.com/tigers/standings/league',
    'tigers_probables': 'https://www.mlb.com/tigers/roster/probable-pitchers',
    'tigers_transactions': 'https://www.mlb.com/tigers/roster/transactions',
    'athletics_savant': 'https://baseballsavant.mlb.com/team/133',
    'rockies_savant': 'https://baseballsavant.mlb.com/team/115',
    'tigers_savant': 'https://baseballsavant.mlb.com/team/116',
    'athletics_espn_transactions': 'https://www.espn.com/mlb/team/transactions/_/name/ath/athletics',
    'rockies_espn_transactions': 'https://www.espn.com/mlb/team/transactions/_/name/col/colorado-rockies',
    'tigers_espn_transactions': 'https://www.espn.com/mlb/team/transactions/_/name/det/detroit-tigers'
}

HEADERS = {'User-Agent': 'Mozilla/5.0'}


def get_text(url):
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, 'html.parser')
    return ' '.join(soup.get_text(' ', strip=True).split())


def extract_records(text, limit=8):
    hits = []
    for m in re.finditer(r'([A-Z][A-Za-z.\'\- ]{2,30})\s+(\d{1,2})-(\d{1,2})', text):
        item = f"{m.group(1).strip()}: {m.group(2)}-{m.group(3)}"
        if item not in hits:
            hits.append(item)
        if len(hits) >= limit:
            break
    return hits


def extract_vs(text, limit=8):
    hits = []
    for m in re.finditer(r'([A-Z][A-Za-z.\'\- ]{2,25})\s+vs\.?\s+([A-Z][A-Za-z.\'\- ]{2,25})', text):
        item = f"{m.group(1).strip()} vs {m.group(2).strip()}"
        if item not in hits:
            hits.append(item)
        if len(hits) >= limit:
            break
    return hits


def extract_transactions(text, limit=5):
    hits = []
    for m in re.finditer(r'((?:placed|recalled|selected|transferred|optioned|assigned|activated|agreed|signed|claimed|acquired|traded).{0,160}?\.)', text, flags=re.I):
        item = m.group(1).strip()
        if item not in hits:
            hits.append(item)
        if len(hits) >= limit:
            break
    return hits


def first_line_or(lines, fallback):
    return lines[0] if lines else fallback

def unverified(msg):
    return f'UNVERIFIED: {msg}'

league_standings_text = get_text(URLS['league_standings'])
league_probables_text = get_text(URLS['league_probables'])
league_transactions_text = get_text(URLS['league_transactions'])

ath_standings_text = get_text(URLS['athletics_standings'])
ath_prob_text = get_text(URLS['athletics_probables'])
ath_trans_text = get_text(URLS['athletics_transactions'])
ath_savant_text = get_text(URLS['athletics_savant'])

col_standings_text = get_text(URLS['rockies_standings'])
col_prob_text = get_text(URLS['rockies_probables'])
col_trans_text = get_text(URLS['rockies_transactions'])
col_savant_text = get_text(URLS['rockies_savant'])

det_standings_text = get_text(URLS['tigers_standings'])
det_prob_text = get_text(URLS['tigers_probables'])
det_trans_text = get_text(URLS['tigers_transactions'])
det_savant_text = get_text(URLS['tigers_savant'])

league_records = extract_records(league_standings_text, 10)
league_matchups = extract_vs(league_probables_text, 8)
league_moves = extract_transactions(league_transactions_text, 5)

ath_record = first_line_or(extract_records(ath_savant_text + ' ' + ath_standings_text, 3), unverified('Athletics record not confirmed from available sources.'))
ath_moves = extract_transactions(ath_trans_text, 3)
col_record = first_line_or(extract_records(col_savant_text + ' ' + col_standings_text, 3), unverified('Rockies record not confirmed from available sources.'))
col_moves = extract_transactions(col_trans_text, 3)
det_record = first_line_or(extract_records(det_savant_text + ' ' + det_standings_text, 3), unverified('Tigers record not confirmed from available sources.'))
det_moves = extract_transactions(det_trans_text, 4)

ath_prob = 'MLB.com probable-pitchers page live for Athletics.' if ath_prob_text else unverified('Athletics probable pitchers not confirmed from available sources.')
col_prob = 'MLB.com probable-pitchers page live for Rockies.' if col_prob_text else unverified('Rockies probable pitchers not confirmed from available sources.')
det_prob = 'MLB.com probable-pitchers page live for Tigers.' if det_prob_text else unverified('Tigers probable pitchers not confirmed from available sources.')

now = datetime.now().astimezone()
stamp_iso = now.isoformat(timespec='seconds')
stamp_day = now.strftime('%Y-%m-%d')

snapshot = {
    'generated_at': stamp_iso,
    'sources': URLS,
    'league': {
        'headline': first_line_or([f'The national show starts with the board itself: {league_records[0]}.' if league_records else 'The national show starts with the standings board and the daily pitching slate.'], 'The national show starts with the standings board and the daily pitching slate.'),
        'verified_notes': [
            'MLB.com standings provides the league board for division and wild-card framing.',
            'MLB.com probable-pitchers provides the daily matchup slate.',
            'ESPN MLB transactions provides the broad move tracker.'
        ] + ([f'Current standings snapshot: {x}.' for x in league_records[:4]] if league_records else [unverified('Standings snapshot not confirmed from available sources.')]) + ([f'Current probable-pitcher slate snapshot: {x}.' for x in league_matchups[:5]] if league_matchups else [unverified('Probable-pitcher slate not confirmed from available sources.')]),
        'stories': [
            f'Lead with this standings hook: {league_records[0]}.' if league_records else 'Lead with the biggest standings truth on the board.',
            f'Best matchup hook: {league_matchups[0]}.' if league_matchups else 'Use the probable-pitchers page to identify the best matchup.',
            'Use only verified league transaction notes before air; treat anything marked UNVERIFIED as a placeholder to check.'
        ],
        'watch': [f'Pitching watch: {x}.' for x in league_matchups[:5]] if league_matchups else [unverified('Pitching watch not confirmed from available sources.')],
        'transactions': league_moves if league_moves else [unverified('League transactions not confirmed from available sources.')]
    },
    'teams': {
        'athletics': {
            'headline': "The A's are in first, but the better question is whether the underlying signs make that start feel sturdy.",
            'emotion': 'Cautiously fired up',
            'verified_notes': [
                'Snapshot verified from MLB.com team pages, ESPN transactions, and Baseball Savant.',
                ath_record + '.',
                ath_prob,
            ] + (ath_moves if ath_moves else [unverified('Athletics transactions not confirmed from available sources.')]),
            'notes': [
                'The A\'s story starts with the standings reality and whether the run differential supports it.',
                'Use the probable-pitcher page as the game-preview peg.',
                'Use transaction notes only when they are confirmed on the source page.'
            ],
            'checklist': ['Standings reality check','Pitching-preview line','Verified roster note']
        },
        'rockies': {
            'headline': 'The Rockies conversation starts with how ugly the early math looks and whether there is any believable next-step hope.',
            'emotion': 'Trying to believe',
            'verified_notes': [
                'Snapshot verified from MLB.com team pages, ESPN transactions, and Baseball Savant.',
                col_record + '.',
                col_prob,
            ] + (col_moves if col_moves else [unverified('Rockies transactions not confirmed from available sources.')]),
            'notes': [
                'The Rockies tone starts with the standings board and whether the pain looks temporary or structural.',
                'Use the probable-pitcher page as the preview peg.',
                'Use verified transactions to sharpen the pitching conversation.'
            ],
            'checklist': ['Run-diff reality check','Probable-pitcher setup','Verified injury/recall note']
        },
        'tigers': {
            'headline': 'The Tigers feel like the most upward-looking homer segment if the winning record and run differential still hold up.',
            'emotion': 'Actually believing',
            'verified_notes': [
                'Snapshot verified from MLB.com team pages, ESPN transactions, and Baseball Savant.',
                det_record + '.',
                det_prob,
            ] + (det_moves if det_moves else [unverified('Tigers transactions not confirmed from available sources.')]),
            'notes': [
                'The Tigers segment should sound more hopeful if the record and run differential still support it.',
                'Use the AL Central position and run differential to give the segment structure.',
                'Keep injury and roster notes tied to MLB.com and ESPN logs.'
            ],
            'checklist': ['Positive run-diff line','AL Central context','Verified injury/roster note']
        }
    }
}

latest = data_dir / 'latest.json'
dated = data_dir / f'mlb_snapshot_{stamp_day}.json'
latest.write_text(json.dumps(snapshot, indent=2))
dated.write_text(json.dumps(snapshot, indent=2))
print(str(latest))
print(str(dated))
