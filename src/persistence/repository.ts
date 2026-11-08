// GameRepository의 SQLite 구현 (node:sqlite).
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { GameDate } from '../engine/calendar';
import type { LedgerCategory, LedgerEntry } from '../engine/finance';
import type { BattingTotals, PitchingTotals } from '../engine/stats';
import type { ClubId, ClubProfile, Fixture, FixtureId, PlayerId, PlayerTruth, SeasonStanding } from '../engine/types';
import type { Amateur } from '../engine/amateur';
import type { HistoryLine } from '../engine/history';
import type { StaffMember, TeamKey } from '../engine/staff';
import type { AchievementRow, TeamSeasonTotals, ApprovalRequest, DelegationPolicy, WorkKind, WorkStatus, WorkTask, WpWeek, ApWeek, CalendarEvent, DayCommit, FaEntry, GameMeta, GameRepository, InboxMessage, InitialWorld, Obligation, OfferRow, SalaryTalk, StoredGame, StoredPa, StoredRun } from '../game/ports';

type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);

export class SqliteGameRepository implements GameRepository {
  private stmts = new Map<string, StatementSync>();
  private playerCache: PlayerTruth[] | null = null;

  constructor(private readonly db: DatabaseSync) {}

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  private txDepth = 0;

  /** 중첩 가능한 트랜잭션: 가장 바깥 호출만 BEGIN·COMMIT 한다. 실패하면 전체가 취소된다. */
  private tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try {
        return fn();
      } finally {
        this.txDepth--;
      }
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.playerCache = null;
      throw e;
    } finally {
      this.txDepth = 0;
    }
  }

  transaction<T>(fn: () => T): T {
    return this.tx(fn);
  }

  savePlayers(players: PlayerTruth[]): void {
    const up = this.stmt(
      `INSERT INTO players (id, club_id, level, is_pitcher, position, name, birth_date, salary, truth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET club_id = excluded.club_id, level = excluded.level, position = excluded.position, salary = excluded.salary, truth = excluded.truth`,
    );
    this.tx(() => {
      for (const p of players) up.run(p.id, p.clubId, p.level, p.isPitcher ? 1 : 0, p.position, p.name, p.birthDate, p.salary, JSON.stringify(p));
    });
    this.playerCache = null;
  }

  getFa(offseason: number): FaEntry[] {
    return (this.stmt('SELECT * FROM fa_market WHERE offseason = ? ORDER BY player_id').all(offseason) as Row[]).map((r) => ({
      playerId: num(r.player_id),
      offseason: num(r.offseason),
      originClub: num(r.origin_club),
      status: String(r.status) as FaEntry['status'],
      grade: r.grade === null ? null : (String(r.grade) as FaEntry['grade']),
      priorSalary: num(r.prior_salary),
      demand: JSON.parse(String(r.demand)),
      signedClub: r.signed_club === null ? null : num(r.signed_club),
      signedDate: r.signed_date === null ? null : String(r.signed_date),
      contract: r.contract === null ? null : JSON.parse(String(r.contract)),
    }));
  }

  saveFa(entries: FaEntry[]): void {
    const up = this.stmt(
      `INSERT INTO fa_market (player_id, offseason, origin_club, status, grade, prior_salary, demand, signed_club, signed_date, contract) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(offseason, player_id) DO UPDATE SET status = excluded.status, grade = excluded.grade, demand = excluded.demand, signed_club = excluded.signed_club, signed_date = excluded.signed_date, contract = excluded.contract`,
    );
    this.tx(() => {
      for (const e of entries) up.run(e.playerId, e.offseason, e.originClub, e.status, e.grade, e.priorSalary, JSON.stringify(e.demand), e.signedClub, e.signedDate, e.contract ? JSON.stringify(e.contract) : null);
    });
  }

  insertOffer(o: Omit<OfferRow, 'id'>): number {
    const r = this.stmt('INSERT INTO offers (player_id, club_id, kind, date, offer, status, response) VALUES (?, ?, ?, ?, ?, ?, ?)').run(o.playerId, o.clubId, o.kind, o.date, JSON.stringify(o.offer), o.status, o.response);
    return Number(r.lastInsertRowid);
  }

  updateOffer(id: number, patch: Partial<Pick<OfferRow, 'status' | 'response'>>): void {
    if (patch.status !== undefined) this.stmt('UPDATE offers SET status = ? WHERE id = ?').run(patch.status, id);
    if (patch.response !== undefined) this.stmt('UPDATE offers SET response = ? WHERE id = ?').run(patch.response, id);
  }

  getOffers(filter: { playerId?: number; clubId?: number; status?: OfferRow['status']; kind?: OfferRow['kind'] }): OfferRow[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.playerId !== undefined) (where.push('player_id = ?'), args.push(filter.playerId));
    if (filter.clubId !== undefined) (where.push('club_id = ?'), args.push(filter.clubId));
    if (filter.status !== undefined) (where.push('status = ?'), args.push(filter.status));
    if (filter.kind !== undefined) (where.push('kind = ?'), args.push(filter.kind));
    const sql = `SELECT * FROM offers ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({
      id: num(r.id),
      playerId: num(r.player_id),
      clubId: num(r.club_id),
      kind: String(r.kind) as OfferRow['kind'],
      date: String(r.date),
      offer: JSON.parse(String(r.offer)),
      status: String(r.status) as OfferRow['status'],
      response: String(r.response),
    }));
  }

  addObligation(o: Obligation): void {
    this.stmt('INSERT INTO obligations (club_id, player_id, salary, seasons, memo) VALUES (?, ?, ?, ?, ?)').run(o.clubId, o.playerId, o.salary, JSON.stringify(o.seasons), o.memo);
  }

  getObligations(): Obligation[] {
    return (this.stmt('SELECT * FROM obligations ORDER BY id').all() as Row[]).map((r) => ({
      id: num(r.id),
      clubId: num(r.club_id),
      playerId: num(r.player_id),
      salary: num(r.salary),
      seasons: JSON.parse(String(r.seasons)),
      memo: String(r.memo),
    }));
  }

  getSalaryTalks(offseason: number): SalaryTalk[] {
    return (this.stmt('SELECT * FROM salary_talks WHERE offseason = ? ORDER BY player_id').all(offseason) as Row[]).map((r) => ({
      playerId: num(r.player_id),
      offseason: num(r.offseason),
      clubId: num(r.club_id),
      priorSalary: num(r.prior_salary),
      demand: num(r.demand),
      offer: num(r.offer),
      status: String(r.status) as SalaryTalk['status'],
      final: r.final === null ? null : num(r.final),
    }));
  }

  saveSalaryTalks(rows: SalaryTalk[]): void {
    const up = this.stmt(
      `INSERT INTO salary_talks (player_id, offseason, club_id, prior_salary, demand, offer, status, final) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(offseason, player_id) DO UPDATE SET club_id = excluded.club_id, demand = excluded.demand, offer = excluded.offer, status = excluded.status, final = excluded.final`,
    );
    this.tx(() => {
      for (const t of rows) up.run(t.playerId, t.offseason, t.clubId, t.priorSalary, t.demand, t.offer, t.status, t.final);
    });
  }

  spendAp(weekId: string, amount: number): void {
    const week = this.getApWeek(weekId);
    if (!week || week.granted - week.used < amount) throw new Error(`AP_SHORT:${week ? week.granted - week.used : 0}`);
    this.stmt('UPDATE ap_ledger SET used = used + ? WHERE week_id = ?').run(amount, weekId);
  }

  addLedger(entries: LedgerEntry[]): void {
    const season = this.getMeta().season;
    this.insertLedger(entries, season);
  }

  addInbox(messages: InboxMessage[]): void {
    this.insertInbox(messages);
  }

  private writeMeta(partial: Partial<GameMeta>): void {
    const put = this.stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(partial)) put.run(k, JSON.stringify(v));
  }

  setMetaValue(key: string, value: unknown): void {
    this.writeMeta({ [key]: value } as Partial<GameMeta>);
  }

  getMetaValue<T>(key: string): T | undefined {
    const row = this.stmt('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }

  private insertFixtures(fixtures: Fixture[]): void {
    const ins = this.stmt('INSERT INTO fixtures (id, season, date, home, away, series_id, game_in_series, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const f of fixtures) ins.run(f.id, f.season, f.date, f.home, f.away, f.seriesId, f.gameInSeries, f.stage ?? 'regular');
  }

  private insertInbox(messages: InboxMessage[]): void {
    const ins = this.stmt('INSERT INTO inbox (date, kind, sender, title, body) VALUES (?, ?, ?, ?, ?)');
    for (const m of messages) ins.run(m.date, m.kind, m.sender, m.title, m.body);
  }

  private insertLedger(entries: LedgerEntry[], season: number): void {
    const ins = this.stmt('INSERT INTO ledger (club_id, date, season, category, amount, memo) VALUES (?, ?, ?, ?, ?, ?)');
    for (const e of entries) ins.run(e.clubId, e.date, season, e.category, e.amount, e.memo);
  }

  // ───────── 기록·업적 (2e) ─────────

  getAmateurs(status?: Amateur['status']): Amateur[] {
    const rows = (status ? this.stmt('SELECT data FROM amateurs WHERE status = ? ORDER BY id').all(status) : this.stmt('SELECT data FROM amateurs ORDER BY id').all()) as Row[];
    return rows.map((r) => JSON.parse(String(r.data)) as Amateur);
  }

  saveAmateurs(list: Amateur[]): void {
    const up = this.stmt('INSERT INTO amateurs (id, status, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data');
    this.tx(() => {
      for (const a of list) up.run(a.id, a.status, JSON.stringify(a));
    });
  }

  nextAmateurId(): number {
    return num((this.stmt('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM amateurs').get() as Row).next);
  }

  getHistory(filter: { playerIds?: PlayerId[]; season?: number }): HistoryLine[] {
    const args: number[] = [];
    const season = filter.season !== undefined ? (args.push(filter.season), ' AND season = ?') : '';
    const sql = `SELECT * FROM history_lines WHERE 1 = 1${season}${this.idFilter('player_id', filter.playerIds)} ORDER BY player_id, season`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({
      playerId: num(r.player_id),
      season: num(r.season),
      clubId: num(r.club_id),
      kind: String(r.kind) as HistoryLine['kind'],
      totals: JSON.parse(String(r.totals)),
    }));
  }

  insertHistory(lines: HistoryLine[]): void {
    const ins = this.stmt('INSERT OR REPLACE INTO history_lines (player_id, season, club_id, kind, totals) VALUES (?, ?, ?, ?, ?)');
    this.tx(() => {
      for (const l of lines) ins.run(l.playerId, l.season, l.clubId, l.kind, JSON.stringify(l.totals));
    });
  }

  countHistory(): number {
    return num((this.stmt('SELECT COUNT(*) AS n FROM history_lines').get() as Row).n);
  }

  teamTotals(season: number): TeamSeasonTotals[] {
    const bat = this.stmt(
      `SELECT batting_club AS club, COUNT(DISTINCT game_id) AS G, COUNT(*) AS PA, SUM(outcome NOT IN ('BB','HBP','SF')) AS AB,
              SUM(outcome IN ('1B','2B','3B','HR')) AS H, SUM(outcome = '2B') AS D, SUM(outcome = '3B') AS T, SUM(outcome = 'HR') AS HR,
              SUM(rbi) AS RBI, SUM(outcome = 'BB') AS BB, SUM(outcome = 'HBP') AS HBP, SUM(outcome = 'K') AS SO, SUM(outcome = 'SF') AS SF
         FROM plate_appearances WHERE stage = 'regular' AND season = ? GROUP BY batting_club`,
    ).all(season) as Row[];
    const pit = this.stmt(
      `SELECT CASE WHEN pa.batting_club = g.home THEN g.away ELSE g.home END AS club, SUM(pa.outs_on_play) AS OUTS, COUNT(*) AS BF,
              SUM(pa.outcome IN ('1B','2B','3B','HR')) AS H, SUM(pa.outcome = 'BB') AS BB, SUM(pa.outcome = 'HBP') AS HBP,
              SUM(pa.outcome = 'K') AS K, SUM(pa.outcome = 'HR') AS HR, SUM(pa.pitches) AS P
         FROM plate_appearances pa JOIN games g ON g.fixture_id = pa.game_id WHERE pa.stage = 'regular' AND pa.season = ? GROUP BY club`,
    ).all(season) as Row[];
    const er = this.stmt(
      `SELECT CASE WHEN r.batting_club = g.home THEN g.away ELSE g.home END AS club, SUM(r.earned) AS ER
         FROM runs r JOIN games g ON g.fixture_id = r.game_id WHERE r.stage = 'regular' AND r.season = ? GROUP BY club`,
    ).all(season) as Row[];
    const games = this.stmt("SELECT home, away, home_runs, away_runs, sv FROM games WHERE stage = 'regular' AND season = ?").all(season) as Row[];
    const clubs = new Set<number>([...bat.map((r) => num(r.club)), ...pit.map((r) => num(r.club))]);
    return [...clubs].sort((a, b) => a - b).map((club) => {
      const b = bat.find((r) => num(r.club) === club);
      const p = pit.find((r) => num(r.club) === club);
      let W = 0, L = 0, SV = 0, GS = 0, rf = 0, ra = 0;
      for (const g of games) {
        const home = num(g.home) === club;
        if (!home && num(g.away) !== club) continue;
        GS++;
        const mine = home ? num(g.home_runs) : num(g.away_runs);
        const theirs = home ? num(g.away_runs) : num(g.home_runs);
        rf += mine;
        ra += theirs;
        if (mine > theirs) (W++, g.sv !== null && SV++);
        else if (mine < theirs) L++;
      }
      return {
        clubId: club,
        bat: { G: num(b?.G), PA: num(b?.PA), AB: num(b?.AB), H: num(b?.H), '2B': num(b?.D), '3B': num(b?.T), HR: num(b?.HR), RBI: num(b?.RBI), R: rf, BB: num(b?.BB), HBP: num(b?.HBP), SO: num(b?.SO), SF: num(b?.SF) },
        pit: { G: GS, GS, OUTS: num(p?.OUTS), W, L, SV, BF: num(p?.BF), H: num(p?.H), R: ra, ER: num(er.find((r) => num(r.club) === club)?.ER), BB: num(p?.BB), HBP: num(p?.HBP), K: num(p?.K), HR: num(p?.HR), pitches: num(p?.P) },
        runsFor: rf,
        runsAgainst: ra,
      };
    });
  }

  getAchievements(): AchievementRow[] {
    return (this.stmt('SELECT * FROM achievements ORDER BY date, key').all() as Row[]).map((r) => ({ key: String(r.key), season: num(r.season), date: String(r.date), detail: String(r.detail), xp: num(r.xp) }));
  }

  insertAchievement(a: AchievementRow): void {
    this.stmt('INSERT INTO achievements (key, season, date, detail, xp) VALUES (?, ?, ?, ?, ?)').run(a.key, a.season, a.date, a.detail, a.xp);
  }

  updateMeta(partial: Partial<GameMeta>): void {
    this.writeMeta(partial);
  }

  // ───────── 조직·위임 (2c) ─────────

  getStaff(clubId?: ClubId | null): StaffMember[] {
    const rows = (clubId === undefined
      ? this.stmt('SELECT data FROM staff ORDER BY id').all()
      : clubId === null
        ? this.stmt('SELECT data FROM staff WHERE club_id IS NULL ORDER BY id').all()
        : this.stmt('SELECT data FROM staff WHERE club_id = ? ORDER BY id').all(clubId)) as Row[];
    return rows.map((r) => JSON.parse(String(r.data)) as StaffMember);
  }

  saveStaff(staff: StaffMember[]): void {
    const up = this.stmt('INSERT INTO staff (id, club_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET club_id = excluded.club_id, data = excluded.data');
    this.tx(() => {
      for (const s of staff) up.run(s.id, s.clubId, JSON.stringify(s));
    });
  }

  deleteStaff(ids: number[]): void {
    const del = this.stmt('DELETE FROM staff WHERE id = ?');
    this.tx(() => {
      for (const id of ids) del.run(id);
    });
  }

  nextStaffId(): number {
    const r = this.stmt('SELECT COALESCE(MAX(id), 0) + 1 AS next FROM staff').get() as Row;
    return num(r.next);
  }

  getWp(weekId: string): WpWeek[] {
    return (this.stmt('SELECT * FROM wp_ledger WHERE week_id = ? ORDER BY team').all(weekId) as Row[]).map((r) => ({
      weekId: String(r.week_id),
      team: String(r.team) as TeamKey,
      granted: num(r.granted),
      upkeep: num(r.upkeep),
      used: num(r.used),
    }));
  }

  insertWp(rows: WpWeek[]): void {
    const ins = this.stmt('INSERT OR IGNORE INTO wp_ledger (week_id, team, granted, upkeep, used) VALUES (?, ?, ?, ?, ?)');
    this.tx(() => {
      for (const w of rows) ins.run(w.weekId, w.team, w.granted, w.upkeep, w.used);
    });
  }

  spendWp(weekId: string, team: TeamKey, amount: number, force = false): void {
    const r = this.stmt('SELECT granted, used FROM wp_ledger WHERE week_id = ? AND team = ?').get(weekId, team) as Row | undefined;
    const left = r ? num(r.granted) - num(r.used) : 0;
    if (!r || (!force && left < amount)) throw new Error(`WP_SHORT:${left}`);
    this.stmt('UPDATE wp_ledger SET used = used + ? WHERE week_id = ? AND team = ?').run(amount, weekId, team);
  }

  getPolicies(): DelegationPolicy[] {
    return (this.stmt('SELECT policy FROM delegation ORDER BY team').all() as Row[]).map((r) => JSON.parse(String(r.policy)) as DelegationPolicy);
  }

  savePolicy(p: DelegationPolicy): void {
    this.stmt('INSERT INTO delegation (team, policy) VALUES (?, ?) ON CONFLICT(team) DO UPDATE SET policy = excluded.policy').run(p.team, JSON.stringify(p));
  }

  getTasks(filter: { status?: WorkStatus[]; kind?: WorkKind; targetId?: number } = {}): WorkTask[] {
    const where: string[] = [];
    const args: Array<string | number> = [];
    if (filter.status?.length) (where.push(`status IN (${filter.status.map(() => '?').join(', ')})`), args.push(...filter.status));
    if (filter.kind !== undefined) (where.push('kind = ?'), args.push(filter.kind));
    if (filter.targetId !== undefined) (where.push('target_id = ?'), args.push(filter.targetId));
    const sql = `SELECT * FROM work_queue ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`;
    return (this.db.prepare(sql).all(...args) as Row[]).map((r) => ({
      id: num(r.id),
      team: String(r.team) as TeamKey,
      kind: String(r.kind) as WorkKind,
      targetId: num(r.target_id),
      params: JSON.parse(String(r.params)),
      status: String(r.status) as WorkStatus,
      created: String(r.created),
      updated: String(r.updated),
      note: String(r.note),
    }));
  }

  insertTask(t: Omit<WorkTask, 'id'>): number {
    const r = this.stmt('INSERT INTO work_queue (team, kind, target_id, params, status, created, updated, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(t.team, t.kind, t.targetId, JSON.stringify(t.params), t.status, t.created, t.updated, t.note);
    return Number(r.lastInsertRowid);
  }

  updateTask(id: number, patch: Partial<Pick<WorkTask, 'status' | 'params' | 'note' | 'updated'>>): void {
    if (patch.status !== undefined) this.stmt('UPDATE work_queue SET status = ? WHERE id = ?').run(patch.status, id);
    if (patch.params !== undefined) this.stmt('UPDATE work_queue SET params = ? WHERE id = ?').run(JSON.stringify(patch.params), id);
    if (patch.note !== undefined) this.stmt('UPDATE work_queue SET note = ? WHERE id = ?').run(patch.note, id);
    if (patch.updated !== undefined) this.stmt('UPDATE work_queue SET updated = ? WHERE id = ?').run(patch.updated, id);
  }

  getApprovals(status?: ApprovalRequest['status']): ApprovalRequest[] {
    const rows = (status ? this.stmt('SELECT * FROM approvals WHERE status = ? ORDER BY id').all(status) : this.stmt('SELECT * FROM approvals ORDER BY id').all()) as Row[];
    return rows.map((r) => ({
      id: num(r.id),
      taskId: num(r.task_id),
      team: String(r.team) as TeamKey,
      kind: String(r.kind) as WorkKind,
      date: String(r.date),
      summary: String(r.summary),
      payload: JSON.parse(String(r.payload)),
      status: String(r.status) as ApprovalRequest['status'],
    }));
  }

  insertApproval(a: Omit<ApprovalRequest, 'id'>): number {
    const r = this.stmt('INSERT INTO approvals (task_id, team, kind, date, summary, payload, status) VALUES (?, ?, ?, ?, ?, ?, ?)').run(a.taskId, a.team, a.kind, a.date, a.summary, JSON.stringify(a.payload), a.status);
    return Number(r.lastInsertRowid);
  }

  updateApproval(id: number, status: ApprovalRequest['status']): void {
    this.stmt('UPDATE approvals SET status = ? WHERE id = ?').run(status, id);
  }

  initialize(world: InitialWorld): void {
    this.tx(() => {
      this.writeMeta(world.meta);
      const insClub = this.stmt('INSERT INTO clubs (id, profile) VALUES (?, ?)');
      for (const c of world.clubs) insClub.run(c.id, JSON.stringify(c));
      const insPlayer = this.stmt(
        'INSERT INTO players (id, club_id, level, is_pitcher, position, name, birth_date, salary, truth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const p of world.players) insPlayer.run(p.id, p.clubId, p.level, p.isPitcher ? 1 : 0, p.position, p.name, p.birthDate, p.salary, JSON.stringify(p));
      this.insertFixtures(world.fixtures);
      const insStanding = this.stmt('INSERT INTO season_standings (season, club_id, rank, wins, losses, ties, postseason) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const s of world.standings) insStanding.run(s.season, s.clubId, s.rank, s.wins, s.losses, s.ties, s.postseason);
      const insEvent = this.stmt('INSERT INTO calendar_events (date, kind, title, body) VALUES (?, ?, ?, ?)');
      for (const e of world.events) insEvent.run(e.date, e.kind, e.title, e.body);
      this.insertInbox(world.inbox);
      this.insertLedger(world.ledger, world.meta.season);
      this.stmt('INSERT INTO ap_ledger (week_id, granted, used) VALUES (?, ?, ?)').run(world.apGrant.weekId, world.apGrant.granted, world.apGrant.used);
      this.saveStaff(world.staff);
      this.insertHistory(world.history);
      this.saveAmateurs(world.amateurs);
    });
    this.playerCache = null;
  }

  getMeta(): GameMeta {
    const rows = this.stmt('SELECT key, value FROM meta').all() as Row[];
    const out: Record<string, unknown> = {};
    for (const r of rows) out[String(r.key)] = JSON.parse(String(r.value));
    return out as unknown as GameMeta;
  }

  getClubs(): ClubProfile[] {
    return (this.stmt('SELECT profile FROM clubs ORDER BY id').all() as Row[]).map((r) => JSON.parse(String(r.profile)) as ClubProfile);
  }

  getPlayers(): PlayerTruth[] {
    if (!this.playerCache) {
      this.playerCache = (this.stmt('SELECT truth FROM players ORDER BY id').all() as Row[]).map((r) => JSON.parse(String(r.truth)) as PlayerTruth);
    }
    return this.playerCache;
  }

  getActivePlayers(clubIds: ClubId[]): PlayerTruth[] {
    const set = new Set(clubIds);
    return this.getPlayers().filter((p) => p.clubId !== null && set.has(p.clubId) && p.level === '1군');
  }

  getPlayer(id: PlayerId): PlayerTruth | null {
    return this.getPlayers().find((p) => p.id === id) ?? null;
  }

  private toFixture(r: Row): Fixture {
    return { id: num(r.id), season: num(r.season), date: String(r.date), home: num(r.home), away: num(r.away), seriesId: num(r.series_id), gameInSeries: num(r.game_in_series), stage: (r.stage ? String(r.stage) : 'regular') as Fixture['stage'] };
  }

  getFixturesOn(date: GameDate): Fixture[] {
    return (this.stmt('SELECT * FROM fixtures WHERE date = ? ORDER BY id').all(date) as Row[]).map((r) => this.toFixture(r));
  }

  getFixtures(season: number): Array<Fixture & { played: boolean }> {
    const rows = this.stmt(
      'SELECT f.*, g.fixture_id IS NOT NULL AS played FROM fixtures f LEFT JOIN games g ON g.fixture_id = f.id WHERE f.season = ? ORDER BY f.date, f.id',
    ).all(season) as Row[];
    return rows.map((r) => ({ ...this.toFixture(r), played: num(r.played) === 1 }));
  }

  addFixtures(fixtures: Fixture[], meta: Partial<GameMeta>): void {
    this.tx(() => {
      this.insertFixtures(fixtures);
      this.writeMeta(meta);
    });
  }

  countFixtures(season: number): { total: number; played: number } {
    const r = this.stmt(
      "SELECT COUNT(*) AS total, SUM(g.fixture_id IS NOT NULL) AS played FROM fixtures f LEFT JOIN games g ON g.fixture_id = f.id WHERE f.stage = 'regular' AND f.season = ?",
    ).get(season) as Row;
    return { total: num(r.total), played: num(r.played) };
  }

  getRecentPitcherUsage(fromDate: GameDate, toDateExclusive: GameDate) {
    const rows = this.stmt(
      `SELECT pa.date AS date, pa.pitcher_id AS pitcher_id, SUM(pa.pitches) AS pitches,
              MAX(g.home_sp = pa.pitcher_id OR g.away_sp = pa.pitcher_id) AS started
         FROM plate_appearances pa JOIN games g ON g.fixture_id = pa.game_id
        WHERE pa.date >= ? AND pa.date < ?
        GROUP BY pa.date, pa.pitcher_id`,
    ).all(fromDate, toDateExclusive) as Row[];
    return rows.map((r) => ({ date: String(r.date), pitcherId: num(r.pitcher_id), pitches: num(r.pitches), started: num(r.started) === 1, daysAgo: 0 }));
  }

  getLastStarters(season: number): Map<ClubId, PlayerId> {
    const rows = this.stmt('SELECT home, away, home_sp, away_sp FROM games WHERE season = ? ORDER BY date, fixture_id').all(season) as Row[];
    const out = new Map<ClubId, PlayerId>();
    for (const r of rows) {
      out.set(num(r.home), num(r.home_sp));
      out.set(num(r.away), num(r.away_sp));
    }
    return out;
  }

  isDayProcessed(date: GameDate): boolean {
    return Boolean(this.stmt('SELECT 1 FROM processed_days WHERE date = ?').get(date));
  }

  commitDay(date: GameDate, commit: DayCommit): void {
    const { results, metaUpdate } = commit;
    const meta = this.getMeta();
    this.tx(() => {
      this.insertLedger(commit.ledger, meta.season);
      this.insertInbox(commit.inbox);
      if (commit.apGrant) {
        this.stmt('INSERT INTO ap_ledger (week_id, granted, used) VALUES (?, ?, ?)').run(commit.apGrant.weekId, commit.apGrant.granted, commit.apGrant.used);
      }
      // 같은 날짜를 두 번 처리하지 않는다: 기본키 충돌로 전체 변경이 취소된다.
      this.stmt('INSERT INTO processed_days (date) VALUES (?)').run(date);
      const insGame = this.stmt(
        `INSERT INTO games (fixture_id, season, date, home, away, home_runs, away_runs, innings, home_sp, away_sp, wp, lp, sv, line_score, stage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insPa = this.stmt(
        `INSERT INTO plate_appearances (game_id, seq, season, date, inning, half, batting_club, batter_id, pitcher_id, outcome, rbi, outs_on_play, pitches, stage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insRun = this.stmt(
        'INSERT INTO runs (game_id, seq, idx, season, batting_club, runner_id, pitcher_id, earned, stage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const stageOf = this.stmt('SELECT stage FROM fixtures WHERE id = ?');
      for (const r of results) {
        const stage = String((stageOf.get(r.fixtureId) as Row | undefined)?.stage ?? 'regular');
        insGame.run(r.fixtureId, meta.season, date, r.home, r.away, r.homeRuns, r.awayRuns, r.innings, r.starters.home, r.starters.away, r.winningPitcher, r.losingPitcher, r.savePitcher, JSON.stringify(r.lineScore), stage);
        for (const e of r.events) {
          insPa.run(r.fixtureId, e.seq, meta.season, date, e.inning, e.half, e.battingClub, e.batterId, e.pitcherId, e.outcome, e.rbi, e.outsOnPlay, e.pitches, stage);
        }
        r.runs.forEach((run, idx) => insRun.run(r.fixtureId, run.seq, idx, meta.season, run.battingClub, run.runnerId, run.pitcherId, run.earned ? 1 : 0, stage));
      }
      this.writeMeta(metaUpdate);
    });
  }

  private toGame(r: Row): StoredGame {
    return {
      fixtureId: num(r.fixture_id),
      season: num(r.season),
      date: String(r.date),
      home: num(r.home),
      away: num(r.away),
      homeRuns: num(r.home_runs),
      awayRuns: num(r.away_runs),
      innings: num(r.innings),
      homeStarter: num(r.home_sp),
      awayStarter: num(r.away_sp),
      winningPitcher: r.wp === null ? null : num(r.wp),
      losingPitcher: r.lp === null ? null : num(r.lp),
      savePitcher: r.sv === null ? null : num(r.sv),
      lineScore: JSON.parse(String(r.line_score)),
    };
  }

  getGames(season: number, stage: 'regular' | 'postseason' = 'regular'): StoredGame[] {
    const sql = stage === 'regular' ? "SELECT * FROM games WHERE stage = 'regular' AND season = ? ORDER BY date, fixture_id" : "SELECT * FROM games WHERE stage != 'regular' AND season = ? ORDER BY date, fixture_id";
    return (this.stmt(sql).all(season) as Row[]).map((r) => this.toGame(r));
  }

  getGame(fixtureId: FixtureId): StoredGame | null {
    const r = this.stmt('SELECT * FROM games WHERE fixture_id = ?').get(fixtureId) as Row | undefined;
    return r ? this.toGame(r) : null;
  }

  getGameEvents(fixtureId: FixtureId): { pas: StoredPa[]; runs: StoredRun[] } {
    const pas = (this.stmt('SELECT * FROM plate_appearances WHERE game_id = ? ORDER BY seq').all(fixtureId) as Row[]).map((r) => ({
      seq: num(r.seq),
      inning: num(r.inning),
      half: String(r.half) as 'T' | 'B',
      battingClub: num(r.batting_club),
      batterId: num(r.batter_id),
      pitcherId: num(r.pitcher_id),
      outcome: String(r.outcome),
      rbi: num(r.rbi),
      outsOnPlay: num(r.outs_on_play),
      pitches: num(r.pitches),
    }));
    const runs = (this.stmt('SELECT * FROM runs WHERE game_id = ? ORDER BY idx').all(fixtureId) as Row[]).map((r) => ({
      seq: num(r.seq),
      runnerId: num(r.runner_id),
      pitcherId: num(r.pitcher_id),
      earned: num(r.earned) === 1,
      battingClub: num(r.batting_club),
    }));
    return { pas, runs };
  }

  private idFilter(column: string, ids?: PlayerId[]): string {
    if (!ids) return '';
    if (ids.length === 0) return ' AND 0';
    return ` AND ${column} IN (${ids.map((n) => Math.trunc(n)).join(',')})`;
  }

  battingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, BattingTotals> {
    const club = clubId === undefined ? '' : ` AND batting_club = ${Math.trunc(clubId)}`;
    const rows = this.db
      .prepare(
        `SELECT batter_id AS id, COUNT(DISTINCT game_id) AS G, COUNT(*) AS PA,
                SUM(outcome NOT IN ('BB','HBP','SF')) AS AB,
                SUM(outcome IN ('1B','2B','3B','HR')) AS H,
                SUM(outcome = '2B') AS D, SUM(outcome = '3B') AS T, SUM(outcome = 'HR') AS HR,
                SUM(rbi) AS RBI, SUM(outcome = 'BB') AS BB, SUM(outcome = 'HBP') AS HBP,
                SUM(outcome = 'K') AS SO, SUM(outcome = 'SF') AS SF
           FROM plate_appearances WHERE stage = 'regular' AND season = ?${this.idFilter('batter_id', playerIds)}${club} GROUP BY batter_id`,
      )
      .all(season) as Row[];
    const runs = this.db
      .prepare(`SELECT runner_id AS id, COUNT(*) AS R FROM runs WHERE stage = 'regular' AND season = ?${this.idFilter('runner_id', playerIds)}${club} GROUP BY runner_id`)
      .all(season) as Row[];
    const runMap = new Map(runs.map((r) => [num(r.id), num(r.R)]));
    const out = new Map<PlayerId, BattingTotals>();
    for (const r of rows) {
      const id = num(r.id);
      out.set(id, { G: num(r.G), PA: num(r.PA), AB: num(r.AB), H: num(r.H), '2B': num(r.D), '3B': num(r.T), HR: num(r.HR), RBI: num(r.RBI), R: runMap.get(id) ?? 0, BB: num(r.BB), HBP: num(r.HBP), SO: num(r.SO), SF: num(r.SF) });
    }
    return out;
  }

  pitchingTotals(season: number, playerIds?: PlayerId[], clubId?: ClubId): Map<PlayerId, PitchingTotals> {
    // 구단 지정 시: 그 구단 경기에서 상대 타석만(그 구단 소속으로 던진 기록)
    const c = clubId === undefined ? null : Math.trunc(clubId);
    const club = c === null ? '' : ` AND batting_club != ${c} AND game_id IN (SELECT fixture_id FROM games WHERE home = ${c} OR away = ${c})`;
    const rows = this.db
      .prepare(
        `SELECT pitcher_id AS id, COUNT(DISTINCT game_id) AS G, SUM(outs_on_play) AS OUTS, COUNT(*) AS BF,
                SUM(outcome IN ('1B','2B','3B','HR')) AS H, SUM(outcome = 'BB') AS BB, SUM(outcome = 'HBP') AS HBP,
                SUM(outcome = 'K') AS K, SUM(outcome = 'HR') AS HR, SUM(pitches) AS P
           FROM plate_appearances WHERE stage = 'regular' AND season = ?${this.idFilter('pitcher_id', playerIds)}${club} GROUP BY pitcher_id`,
      )
      .all(season) as Row[];
    const runs = this.db
      .prepare(`SELECT pitcher_id AS id, COUNT(*) AS R, SUM(earned) AS ER FROM runs WHERE stage = 'regular' AND season = ?${this.idFilter('pitcher_id', playerIds)}${club} GROUP BY pitcher_id`)
      .all(season) as Row[];
    const runMap = new Map(runs.map((r) => [num(r.id), { R: num(r.R), ER: num(r.ER) }]));
    const decisions = this.db
      .prepare(
        `SELECT id, SUM(gs) AS GS, SUM(w) AS W, SUM(l) AS L, SUM(s) AS SV FROM (
           SELECT home_sp AS id, 1 AS gs, 0 AS w, 0 AS l, 0 AS s FROM games WHERE stage = 'regular' AND season = ?1
           UNION ALL SELECT away_sp, 1, 0, 0, 0 FROM games WHERE stage = 'regular' AND season = ?1
           UNION ALL SELECT wp, 0, 1, 0, 0 FROM games WHERE stage = 'regular' AND season = ?1 AND wp IS NOT NULL
           UNION ALL SELECT lp, 0, 0, 1, 0 FROM games WHERE stage = 'regular' AND season = ?1 AND lp IS NOT NULL
           UNION ALL SELECT sv, 0, 0, 0, 1 FROM games WHERE stage = 'regular' AND season = ?1 AND sv IS NOT NULL
         ) GROUP BY id`,
      )
      .all(season) as Row[];
    const decMap = new Map(decisions.map((r) => [num(r.id), r]));
    const out = new Map<PlayerId, PitchingTotals>();
    for (const r of rows) {
      const id = num(r.id);
      const d = decMap.get(id);
      const rr = runMap.get(id);
      out.set(id, { G: num(r.G), GS: num(d?.GS), OUTS: num(r.OUTS), W: num(d?.W), L: num(d?.L), SV: num(d?.SV), BF: num(r.BF), H: num(r.H), R: rr?.R ?? 0, ER: rr?.ER ?? 0, BB: num(r.BB), HBP: num(r.HBP), K: num(r.K), HR: num(r.HR), pitches: num(r.P) });
    }
    return out;
  }

  addCalendarEvents(events: CalendarEvent[]): void {
    const ins = this.stmt('INSERT OR REPLACE INTO calendar_events (date, kind, title, body) VALUES (?, ?, ?, ?)');
    this.tx(() => {
      for (const e of events) ins.run(e.date, e.kind, e.title, e.body);
    });
  }

  saveSeasonStandings(rows: SeasonStanding[]): void {
    const up = this.stmt('INSERT OR REPLACE INTO season_standings (season, club_id, rank, wins, losses, ties, postseason) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.tx(() => {
      for (const s of rows) up.run(s.season, s.clubId, s.rank, s.wins, s.losses, s.ties, s.postseason);
    });
  }

  getSeasonStandings(season: number): SeasonStanding[] {
    return (this.stmt('SELECT * FROM season_standings WHERE season = ? ORDER BY rank').all(season) as Row[]).map((r) => ({
      season: num(r.season),
      clubId: num(r.club_id),
      rank: num(r.rank),
      wins: num(r.wins),
      losses: num(r.losses),
      ties: num(r.ties),
      postseason: String(r.postseason),
    }));
  }

  getCalendarEvents(fromDate: GameDate, toDate: GameDate): CalendarEvent[] {
    return (this.stmt('SELECT * FROM calendar_events WHERE date >= ? AND date <= ? ORDER BY date').all(fromDate, toDate) as Row[]).map((r) => ({
      date: String(r.date),
      kind: String(r.kind),
      title: String(r.title),
      body: String(r.body),
    }));
  }

  getInbox(limit: number) {
    return (this.stmt('SELECT * FROM inbox ORDER BY date DESC, id DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: num(r.id),
      date: String(r.date),
      kind: String(r.kind) as InboxMessage['kind'],
      sender: String(r.sender),
      title: String(r.title),
      body: String(r.body),
      read: num(r.read) === 1,
    }));
  }

  markInboxRead(id: number): void {
    this.stmt('UPDATE inbox SET read = 1 WHERE id = ?').run(id);
  }

  getApWeek(weekId: string): ApWeek | null {
    const r = this.stmt('SELECT * FROM ap_ledger WHERE week_id = ?').get(weekId) as Row | undefined;
    return r ? { weekId: String(r.week_id), granted: num(r.granted), used: num(r.used) } : null;
  }

  cashBalance(clubId: ClubId): number {
    const r = this.stmt('SELECT COALESCE(SUM(amount), 0) AS cash FROM ledger WHERE club_id = ?').get(clubId) as Row;
    return num(r.cash);
  }

  ledgerByCategory(clubId: ClubId, season: number) {
    return (this.stmt('SELECT category, SUM(amount) AS amount FROM ledger WHERE club_id = ? AND season = ? GROUP BY category ORDER BY amount DESC').all(clubId, season) as Row[]).map((r) => ({
      category: String(r.category) as LedgerCategory,
      amount: num(r.amount),
    }));
  }

  ledgerEntries(clubId: ClubId, limit: number) {
    return (this.stmt('SELECT * FROM ledger WHERE club_id = ? ORDER BY date DESC, id DESC LIMIT ?').all(clubId, limit) as Row[]).map((r) => ({
      id: num(r.id),
      clubId: num(r.club_id),
      date: String(r.date),
      season: num(r.season),
      category: String(r.category) as LedgerCategory,
      amount: num(r.amount),
      memo: String(r.memo),
    }));
  }

  leaguePitchingTotals(season: number): PitchingTotals {
    const r = this.stmt(
      `SELECT SUM(outs_on_play) AS OUTS, COUNT(*) AS BF, SUM(outcome IN ('1B','2B','3B','HR')) AS H, SUM(outcome = 'BB') AS BB,
              SUM(outcome = 'HBP') AS HBP, SUM(outcome = 'K') AS K, SUM(outcome = 'HR') AS HR, SUM(pitches) AS P
         FROM plate_appearances WHERE stage = 'regular' AND season = ?`,
    ).get(season) as Row;
    const runs = this.stmt("SELECT COUNT(*) AS R, SUM(earned) AS ER FROM runs WHERE stage = 'regular' AND season = ?").get(season) as Row;
    const games = this.stmt("SELECT COUNT(*) AS n FROM games WHERE stage = 'regular' AND season = ?").get(season) as Row;
    return { G: num(games.n), GS: num(games.n) * 2, OUTS: num(r.OUTS), W: 0, L: 0, SV: 0, BF: num(r.BF), H: num(r.H), R: num(runs.R), ER: num(runs.ER), BB: num(r.BB), HBP: num(r.HBP), K: num(r.K), HR: num(r.HR), pitches: num(r.P) };
  }
}
