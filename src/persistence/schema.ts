// 세이브 파일 스키마와 버전 관리 (20 문서).
// 스키마가 바뀌면 SCHEMA_VERSION을 올리고 MIGRATIONS에 변환 단계를 추가한다.
// 변환은 항상 세션 사본에서 실행하고, 원래 세이브 파일은 건드리지 않는다.
import type { DatabaseSync } from 'node:sqlite';

/**
 * 8: 3a 능력치 체계(1~100·세부 능력치·구종·히든 12종, D-086~D-088)와 시즌 리그 환경(D-100). 선수 능력은 truth JSON에 들어 있어 표 구조는 같다.
 * 9: 3a2 존 기반 수비 판정(D-102). 타석에 타구 구역·유형·질·처리 수비수, 수비 기록(자살·보살·실책) 표.
 * 10: 지난 시즌 상세 기록 압축(D-106). 선수별 시즌 타격·투구·수비 합계와 스프레이 차트 합계 표.
 * 출시 전에는 세이브 호환을 보장하지 않는다(D-094): 이전 버전 저장본은 변환하지 않고 불러오기 때 이유를 안내하고 거부한다.
 */
// 11: 고정 관측·보고서 이력·세이브별 메모와 관심 등록(D-113).
// 12: 4c-1 승부처 타석 표시(plate_appearances.clutch, D-167). 타석별 투구 수는 이미 있어 경기별 투수·타자 투구 수는 그 값에서 계산한다.
// 13: 4c-2a 주루 사건 표(plays), 타석의 고의사구·번트 표시, 시즌 합계 도루·도루 실패·폭투·보크·포일(D-170).
// 14: 8a 선수·포지션별 수비 아웃(field_positions, 시즌 압축 표), 투수별 홀드·블론세이브·퀄리티 스타트(pitcher_flags), 리그 시상(awards)(D-180).
export const SCHEMA_VERSION = 16;

const SCHEMA_V3 = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE clubs (id INTEGER PRIMARY KEY, profile TEXT NOT NULL);
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  club_id INTEGER,
  level TEXT NOT NULL,
  is_pitcher INTEGER NOT NULL,
  position TEXT NOT NULL,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  salary INTEGER NOT NULL,
  truth TEXT NOT NULL
);
CREATE INDEX players_club ON players (club_id, level);
CREATE TABLE fixtures (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  date TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  series_id INTEGER NOT NULL,
  game_in_series INTEGER NOT NULL
);
CREATE INDEX fixtures_date ON fixtures (date);
CREATE INDEX fixtures_season ON fixtures (season, date);
CREATE TABLE games (
  fixture_id INTEGER PRIMARY KEY REFERENCES fixtures (id),
  season INTEGER NOT NULL,
  date TEXT NOT NULL,
  home INTEGER NOT NULL,
  away INTEGER NOT NULL,
  home_runs INTEGER NOT NULL,
  away_runs INTEGER NOT NULL,
  innings INTEGER NOT NULL,
  home_sp INTEGER NOT NULL,
  away_sp INTEGER NOT NULL,
  wp INTEGER,
  lp INTEGER,
  sv INTEGER,
  line_score TEXT NOT NULL
);
CREATE INDEX games_season ON games (season, date);
CREATE TABLE plate_appearances (
  game_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  season INTEGER NOT NULL,
  date TEXT NOT NULL,
  inning INTEGER NOT NULL,
  half TEXT NOT NULL,
  batting_club INTEGER NOT NULL,
  batter_id INTEGER NOT NULL,
  pitcher_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  rbi INTEGER NOT NULL,
  outs_on_play INTEGER NOT NULL,
  pitches INTEGER NOT NULL,
  PRIMARY KEY (game_id, seq)
) WITHOUT ROWID;
CREATE INDEX pa_batter ON plate_appearances (season, batter_id);
CREATE INDEX pa_pitcher ON plate_appearances (season, pitcher_id);
CREATE INDEX pa_date ON plate_appearances (date, pitcher_id);
CREATE TABLE runs (
  game_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  season INTEGER NOT NULL,
  batting_club INTEGER NOT NULL,
  runner_id INTEGER NOT NULL,
  pitcher_id INTEGER NOT NULL,
  earned INTEGER NOT NULL,
  PRIMARY KEY (game_id, idx)
) WITHOUT ROWID;
CREATE INDEX runs_runner ON runs (season, runner_id);
CREATE INDEX runs_pitcher ON runs (season, pitcher_id);
CREATE TABLE processed_days (date TEXT PRIMARY KEY);
CREATE TABLE season_standings (
  season INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  ties INTEGER NOT NULL,
  postseason TEXT NOT NULL,
  PRIMARY KEY (season, club_id)
) WITHOUT ROWID;
CREATE TABLE ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  season INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT NOT NULL
);
CREATE INDEX ledger_club ON ledger (club_id, date);
CREATE TABLE ap_ledger (
  week_id TEXT PRIMARY KEY,
  granted INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sender TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX inbox_date ON inbox (date);
CREATE TABLE calendar_events (
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (date, kind)
) WITHOUT ROWID;
CREATE TABLE fa_market (
  player_id INTEGER NOT NULL,
  offseason INTEGER NOT NULL,
  origin_club INTEGER NOT NULL,
  status TEXT NOT NULL,
  grade TEXT,
  prior_salary INTEGER NOT NULL,
  demand TEXT NOT NULL,
  signed_club INTEGER,
  signed_date TEXT,
  contract TEXT,
  PRIMARY KEY (offseason, player_id)
) WITHOUT ROWID;
CREATE TABLE offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  offer TEXT NOT NULL,
  status TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT ''
);
CREATE INDEX offers_player ON offers (player_id, status);
CREATE TABLE obligations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  salary INTEGER NOT NULL,
  seasons TEXT NOT NULL,
  memo TEXT NOT NULL
);
CREATE TABLE salary_talks (
  player_id INTEGER NOT NULL,
  offseason INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  prior_salary INTEGER NOT NULL,
  demand INTEGER NOT NULL,
  offer INTEGER NOT NULL,
  status TEXT NOT NULL,
  final INTEGER,
  PRIMARY KEY (offseason, player_id)
) WITHOUT ROWID;
`;


/** 4: 조직·위임 (2c). 직원(후보 포함), 팀 처리량, 위임 정책, 업무 큐, 결재 요청 */
const SCHEMA_V4_ADDITIONS = `
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  club_id INTEGER,
  data TEXT NOT NULL
);
CREATE INDEX staff_club ON staff (club_id);
CREATE TABLE wp_ledger (
  week_id TEXT NOT NULL,
  team TEXT NOT NULL,
  granted INTEGER NOT NULL,
  upkeep INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (week_id, team)
) WITHOUT ROWID;
CREATE TABLE delegation (team TEXT PRIMARY KEY, policy TEXT NOT NULL);
CREATE TABLE work_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX work_queue_status ON work_queue (status, team);
CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  team TEXT NOT NULL,
  kind TEXT NOT NULL,
  date TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX approvals_status ON approvals (status);
`;

/** 5: 시작 이전 선수 기록(시즌 합계)과 업적 (2e) */
const SCHEMA_V5_ADDITIONS = `
CREATE TABLE history_lines (
  player_id INTEGER NOT NULL,
  season INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  totals TEXT NOT NULL,
  PRIMARY KEY (player_id, season, kind)
) WITHOUT ROWID;
CREATE INDEX history_season ON history_lines (season, club_id);
CREATE TABLE achievements (
  key TEXT NOT NULL,
  season INTEGER NOT NULL,
  date TEXT NOT NULL,
  detail TEXT NOT NULL,
  xp INTEGER NOT NULL,
  PRIMARY KEY (key, season)
) WITHOUT ROWID;
`;

/** 6: 경기 단계 구분(정규시즌·포스트시즌). 정규시즌 통계와 순위는 'regular'만 쓴다 */
const SCHEMA_V6_ADDITIONS = `
ALTER TABLE fixtures ADD COLUMN stage TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE games ADD COLUMN stage TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE plate_appearances ADD COLUMN stage TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'regular';
`;

/** 7: 고교·대학 선수 풀 (D-084) */
const SCHEMA_V7_ADDITIONS = `
CREATE TABLE amateurs (id INTEGER PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX amateurs_status ON amateurs (status);
`;

const SCHEMA_V9_ADDITIONS = `
ALTER TABLE plate_appearances ADD COLUMN bb_zone TEXT;
ALTER TABLE plate_appearances ADD COLUMN bb_type TEXT;
ALTER TABLE plate_appearances ADD COLUMN bb_quality INTEGER;
ALTER TABLE plate_appearances ADD COLUMN fielder_id INTEGER;
CREATE TABLE fielding (
  game_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  season INTEGER NOT NULL,
  club_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'regular',
  PRIMARY KEY (game_id, seq, idx)
) WITHOUT ROWID;
CREATE INDEX fielding_player ON fielding (season, player_id);
`;

const SCHEMA_V10_ADDITIONS = `
CREATE TABLE batting_season (
  season INTEGER NOT NULL, stage TEXT NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
  G INTEGER NOT NULL, PA INTEGER NOT NULL, AB INTEGER NOT NULL, H INTEGER NOT NULL, D INTEGER NOT NULL, T INTEGER NOT NULL,
  HR INTEGER NOT NULL, RBI INTEGER NOT NULL, R INTEGER NOT NULL, BB INTEGER NOT NULL, HBP INTEGER NOT NULL, SO INTEGER NOT NULL, SF INTEGER NOT NULL,
  PRIMARY KEY (season, stage, player_id, club_id)
) WITHOUT ROWID;
CREATE TABLE pitching_season (
  season INTEGER NOT NULL, stage TEXT NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
  G INTEGER NOT NULL, OUTS INTEGER NOT NULL, BF INTEGER NOT NULL, H INTEGER NOT NULL, BB INTEGER NOT NULL, HBP INTEGER NOT NULL,
  K INTEGER NOT NULL, HR INTEGER NOT NULL, P INTEGER NOT NULL, R INTEGER NOT NULL, ER INTEGER NOT NULL,
  PRIMARY KEY (season, stage, player_id, club_id)
) WITHOUT ROWID;
CREATE TABLE fielding_season (
  season INTEGER NOT NULL, stage TEXT NOT NULL, player_id INTEGER NOT NULL, club_id INTEGER NOT NULL,
  PO INTEGER NOT NULL, A INTEGER NOT NULL, E INTEGER NOT NULL,
  PRIMARY KEY (season, stage, player_id, club_id)
) WITHOUT ROWID;
CREATE TABLE spray_season (
  season INTEGER NOT NULL, stage TEXT NOT NULL, player_id INTEGER NOT NULL, zone TEXT NOT NULL, bb_type TEXT NOT NULL,
  n INTEGER NOT NULL, h INTEGER NOT NULL, xbh INTEGER NOT NULL,
  PRIMARY KEY (season, stage, player_id, zone, bb_type)
) WITHOUT ROWID;
`;

export interface Migration {
  from: number;
  to: number;
  description: string;
  up(db: DatabaseSync): void;
}

/**
 * 버전 변환 목록. 출시 전에는 비워 둔다(D-094: 구버전은 변환하지 않고 거부).
 * 출시 후 호환 정책이 정해지면 { from, to, description, up } 단계를 여기에 추가한다.
 */
export const MIGRATIONS: Migration[] = [];

/** 구버전 저장본 안내 문구(D-094) */
export function oldVersionMessage(version: number): string {
  return `이전 개발 빌드(저장 형식 ${version})에서 만든 저장본입니다. 현재 형식은 ${SCHEMA_VERSION}입니다. 출시 전에는 저장본 호환을 보장하지 않아 불러올 수 없습니다. 새 게임을 시작해 주세요.`;
}

export function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

export function createSchema(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.exec(SCHEMA_V3);
    db.exec(SCHEMA_V4_ADDITIONS);
    db.exec(SCHEMA_V5_ADDITIONS);
    db.exec(SCHEMA_V6_ADDITIONS);
    db.exec(SCHEMA_V7_ADDITIONS);
    db.exec(SCHEMA_V9_ADDITIONS);
    db.exec(SCHEMA_V10_ADDITIONS);
    db.exec('ALTER TABLE plate_appearances ADD COLUMN clutch INTEGER NOT NULL DEFAULT 0;');
    db.exec(`ALTER TABLE plate_appearances ADD COLUMN ibb INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE plate_appearances ADD COLUMN bunt TEXT;
      CREATE TABLE plays (
        game_id INTEGER NOT NULL, seq INTEGER NOT NULL, season INTEGER NOT NULL, date TEXT NOT NULL, stage TEXT NOT NULL,
        inning INTEGER NOT NULL, half TEXT NOT NULL, batting_club INTEGER NOT NULL, kind TEXT NOT NULL, runner_id INTEGER, from_base INTEGER NOT NULL,
        pitcher_id INTEGER NOT NULL, catcher_id INTEGER NOT NULL, outs_on_play INTEGER NOT NULL,
        PRIMARY KEY (game_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX plays_runner ON plays (season, runner_id);
      CREATE INDEX plays_pitcher ON plays (season, pitcher_id);
      ALTER TABLE batting_season ADD COLUMN SB INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE batting_season ADD COLUMN CS INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pitching_season ADD COLUMN WP INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE pitching_season ADD COLUMN BK INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE fielding_season ADD COLUMN PB INTEGER NOT NULL DEFAULT 0;`);
    db.exec(`CREATE TABLE scouting_snapshots (club_id INTEGER NOT NULL, player_id INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (club_id, player_id));
      CREATE TABLE scouting_history (club_id INTEGER NOT NULL, player_id INTEGER NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (club_id, player_id, date));
      CREATE TABLE player_notes (player_id INTEGER PRIMARY KEY, text TEXT NOT NULL, watched INTEGER NOT NULL, updated_at TEXT NOT NULL);`);
    db.exec(`CREATE TABLE field_positions (
        game_id INTEGER NOT NULL, season INTEGER NOT NULL, stage TEXT NOT NULL, date TEXT NOT NULL, club_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL, position TEXT NOT NULL, outs INTEGER NOT NULL,
        PRIMARY KEY (game_id, player_id, position)
      ) WITHOUT ROWID;
      CREATE INDEX field_positions_player ON field_positions (season, player_id);
      CREATE TABLE field_positions_season (
        season INTEGER NOT NULL, stage TEXT NOT NULL, club_id INTEGER NOT NULL, player_id INTEGER NOT NULL, position TEXT NOT NULL, outs INTEGER NOT NULL,
        PRIMARY KEY (season, stage, player_id, club_id, position)
      ) WITHOUT ROWID;
      CREATE TABLE pitcher_flags (
        game_id INTEGER NOT NULL, season INTEGER NOT NULL, stage TEXT NOT NULL, date TEXT NOT NULL, club_id INTEGER NOT NULL,
        pitcher_id INTEGER NOT NULL, hld INTEGER NOT NULL, bs INTEGER NOT NULL, qs INTEGER NOT NULL,
        PRIMARY KEY (game_id, pitcher_id)
      ) WITHOUT ROWID;
      CREATE INDEX pitcher_flags_player ON pitcher_flags (season, pitcher_id);
      CREATE TABLE awards (
        season INTEGER NOT NULL, award TEXT NOT NULL, slot TEXT NOT NULL, subject TEXT NOT NULL,
        player_id INTEGER, club_id INTEGER NOT NULL, staff_id INTEGER, date TEXT NOT NULL, score REAL NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY (season, award, slot, subject)
      ) WITHOUT ROWID;
      CREATE INDEX awards_player ON awards (player_id);`);
    // 8e(D-189 (9)): 올스타 기록은 시즌별 한 행(정규 기록 표와 분리)
    db.exec('CREATE TABLE allstar (season INTEGER PRIMARY KEY, data TEXT NOT NULL);');
    // EV-1(D-203 (9)): 카드 발생·처리 기록, 턴 브리핑 뉴스 로그
    db.exec(`CREATE TABLE event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, season INTEGER NOT NULL, week_id TEXT NOT NULL, week INTEGER NOT NULL, date TEXT NOT NULL,
        card_id TEXT NOT NULL, category TEXT NOT NULL, player_id INTEGER, choice_id TEXT NOT NULL, by_who TEXT NOT NULL, outcome TEXT, text TEXT NOT NULL
      );
      CREATE INDEX event_log_season ON event_log (season);
      CREATE TABLE news_log (
        week_id TEXT NOT NULL, season INTEGER NOT NULL, date TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY (week_id, seq)
      ) WITHOUT ROWID;
      CREATE INDEX news_log_season ON news_log (season);`);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 저장본을 현재 버전으로 변환한다. 더 새로운 버전이면 NEWER_VERSION, 변환 단계가 없는 구버전이면 OLD_VERSION 오류(D-094). */
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS, target = SCHEMA_VERSION): number[] {
  const applied: number[] = [];
  let version = readSchemaVersion(db);
  if (version > target) throw new Error(`NEWER_VERSION:${version}`);
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new Error(`OLD_VERSION:${version}`);
    db.exec('BEGIN');
    try {
      step.up(db);
      db.exec(`PRAGMA user_version = ${step.to}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    version = step.to;
    applied.push(version);
  }
  return applied;
}
