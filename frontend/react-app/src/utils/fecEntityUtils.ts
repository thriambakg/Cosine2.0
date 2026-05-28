import { fecSearchAPI, FECSearchHit } from '../services/api';

export const DEFAULT_FEC_CYCLE =
  new Date().getFullYear() % 2 === 0
    ? new Date().getFullYear()
    : new Date().getFullYear() + 1;

export function fecHitKey(hit: FECSearchHit): string {
  return `${hit.entity_type}-${hit.entity_id}`;
}

export function formatFECMoney(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function buildFECEntityTitle(hit: FECSearchHit, cycle?: number): string {
  const cycleLabel = cycle ? ` (${cycle})` : '';
  return `${hit.name}${cycleLabel} · ${hit.entity_type} ${hit.entity_id}`;
}

export type FECEntityContextData = FECSearchHit & {
  cycle: number;
  profile?: Record<string, unknown> | null;
  schedule_preview?: Record<string, unknown>[];
  schedule_meta?: string;
};

export function buildFECEntityContextData(
  hit: FECSearchHit,
  cycle: number,
  extras?: {
    profile?: Record<string, unknown> | null;
    schedule_preview?: Record<string, unknown>[];
    schedule_meta?: string;
  }
): FECEntityContextData {
  return {
    ...hit,
    cycle,
    profile: extras?.profile ?? undefined,
    schedule_preview: extras?.schedule_preview,
    schedule_meta: extras?.schedule_meta,
  };
}

/** Load indexed profile + optional Schedule A preview for ItemDetails / context. */
export async function loadFECEntityDetails(
  hit: FECSearchHit,
  cycle: number
): Promise<FECEntityContextData> {
  const base = buildFECEntityContextData(hit, cycle);
  try {
    const resp = await fecSearchAPI.getProfile({
      entity_type: hit.entity_type,
      entity_id: hit.entity_id,
      cycle,
    });
    if (!resp.success || !resp.result) {
      return base;
    }
    const profile = resp.result;
    let schedule_preview: Record<string, unknown>[] | undefined;
    let schedule_meta: string | undefined;

    const principalId =
      (profile.principal_committee_id as string) ||
      (
        profile.committees as
          | { committee_id?: string; designation?: string }[]
          | undefined
      )?.find((c) => c.designation === 'P')?.committee_id;
    const committeeId =
      hit.entity_type === 'committee' ? hit.entity_id : principalId;

    if (committeeId) {
      const sched = await fecSearchAPI.getSchedules({
        entity_id: committeeId,
        cycle,
        schedule: 'schedule_a',
        page: 1,
        per_page: 10,
      });
      if (sched.success && sched.results?.length) {
        schedule_preview = sched.results;
        schedule_meta = `Schedule A preview: ${sched.count} of ${sched.total_rows} rows (page 1)`;
      }
    }

    return buildFECEntityContextData(hit, cycle, {
      profile,
      schedule_preview,
      schedule_meta,
    });
  } catch (err) {
    console.warn('FEC profile load failed:', err);
    return base;
  }
}
