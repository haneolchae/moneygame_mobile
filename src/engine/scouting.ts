// 관측은 저장하고 조회에서는 재추첨하지 않는다(D-113).
import { diffDays } from './calendar';
import { stableNormal } from './rng';
import { observePlayer } from './observation';
import { SCOUTING } from './scoutingConfig';
export { SCOUTING } from './scoutingConfig';
import type { PlayerTruth } from './types';
import { EVENTS } from './config';
import { reputationNotes, scoutSkill, type ReputationNote } from './events/life';

export interface ScoutingSnapshot {
  playerId: number;
  clubId: number;
  date: string;
  observer: string;
  confidence: number;
  evidence: string[];
  centers: Record<string, number>;
  traits: Array<{ label: string; text: string }>;
  /** EV-4(D-210 (2)) 평판 메모(신뢰도 40 이상, 다시 조사해도 같음) */
  reputation?: ReputationNote[];
}
export function currentRatings(p: PlayerTruth): Record<string, number> {
  const out = observePlayer('', p.clubId ?? -1, { ...p, clubId: p.clubId ?? -1 });
  for (const [pos, value] of Object.entries(p.positions)) out[`pos_${pos}`] = value!;
  for (const [i, pitch] of (p.pitches ?? []).entries()) {
    for (const key of ['velocity', 'movement', 'command', 'quality', 'mastery', 'usage'] as const) out[`pitch_${i}_${key}`] = pitch[key];
  }
  return out;
}
export const velocityRating = (key: string) => key === 'velocityAvg' || key === 'velocityMax' || key.endsWith('_velocity');
export const usageRating = (key: string) => key.endsWith('_usage');
export function createSnapshot(seed: string, clubId: number, p: PlayerTruth, date: string, observer: string, scale: number, previous?: ScoutingSnapshot): ScoutingSnapshot {
  const confidence = previous ? Math.min(SCOUTING.maxConfidence, previous.confidence + SCOUTING.confidenceStep / Math.max(SCOUTING.minTeamScale, scale)) : 0;
  const centers: Record<string, number> = {};
  for (const [key, value] of Object.entries(currentRatings(p))) {
    const unit = usageRating(key) ? SCOUTING.usageUnit : velocityRating(key) ? SCOUTING.velocityUnit : 1;
    // 관측자 교체·조사 반복으로 독립 오차를 평균내지 못하도록 같은 선수·항목 편향을 유지한다.
    const error = stableNormal(seed, 'scouting', clubId, p.id, key) * SCOUTING.observationSd * scale * (1 - confidence / SCOUTING.confidenceDecay) * unit;
    const upper = usageRating(key) ? 1 : velocityRating(key) ? SCOUTING.velocityMax : 100;
    centers[key] = Math.max(usageRating(key) ? 0 : velocityRating(key) ? SCOUTING.velocityMin : key.startsWith('pos_') ? 0 : 1, Math.min(upper, Math.round((value + error) / unit) * unit));
  }
  const traits = confidence >= SCOUTING.traitThreshold ? traitOpinions(p, seed, clubId, scale) : [];
  const reputation = confidence >= EVENTS.repThreshold ? reputationNotes(seed, clubId, p, scoutSkill(scale)) : undefined;
  return { playerId: p.id, clubId, date, observer, confidence, evidence: [...(previous?.evidence ?? []), `report:${p.id}:${date}`], centers, traits, ...(reputation ? { reputation } : {}) };
}
function traitOpinions(p: PlayerTruth, seed: string, clubId: number, scale: number): ScoutingSnapshot['traits'] {
  const specs = [
    ['workEthic', '훈련 태도', '꾸준히 훈련하는 편', '훈련 동기 확인 필요'],
    ['coachability', '지도 수용', '지도에 잘 반응하는 편', '지도 방식 조율 필요'],
    ['consistency', '일관성', '수행이 안정적인 편', '경기별 기복이 있는 편'],
    ['pressureSensitivity', '압박 반응', '압박에 민감한 편', '압박에도 침착한 편'],
    ['leadership', '리더십', '동료를 이끄는 편', '개인 역할에 집중하는 편'],
  ] as const;
  return specs.map(([key, label, high, low]) => {
    const estimate = p.hidden[key] + stableNormal(seed, 'trait', clubId, p.id, key) * SCOUTING.traitSd * scale;
    return { label, text: estimate >= SCOUTING.traitHigh ? high : estimate <= SCOUTING.traitLow ? low : '뚜렷한 경향 판단 유보' };
  });
}
export function snapshotRanges(s: ScoutingSnapshot, today: string): Record<string, { low: number; high: number }> {
  const age = Math.max(0, diffDays(today, s.date));
  const width = Math.min(SCOUTING.initialWidth, Math.max(SCOUTING.minWidth, SCOUTING.initialWidth - (SCOUTING.initialWidth - SCOUTING.minWidth) * s.confidence / 100) + Math.floor(age / SCOUTING.staleDays) * SCOUTING.staleWidth);
  return Object.fromEntries(Object.entries(s.centers).map(([key, center]) => {
    const w = usageRating(key) ? width / 100 : velocityRating(key) ? width * SCOUTING.velocityWidth / SCOUTING.initialWidth : width;
    const min = usageRating(key) ? 0 : velocityRating(key) ? SCOUTING.velocityMin : key.startsWith('pos_') ? 0 : 1;
    const max = usageRating(key) ? 1 : velocityRating(key) ? SCOUTING.velocityMax : 100;
    const factor = usageRating(key) ? 100 : 1;
    return [key, { low: Math.max(min, Math.floor((center - w) * factor) / factor), high: Math.min(max, Math.ceil((center + w) * factor) / factor) }];
  }));
}
