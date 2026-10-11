import { sha256Hex } from './sha256';
import { DATA_STORES, ProgressStore, SCHEMA_VERSION, type StoreName } from './db';

export const BACKUP_FORMAT = 'bahad1-progress';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  contentVersion: string;
  exportedAt: string;
  app: string;
  data: { meta: { xp: number; preferences: unknown; lastPosition: unknown }; stores: Record<string, unknown[]> };
  checksum: string; // sha256 of the canonical JSON of `data`
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export async function buildBackup(store: ProgressStore, contentVersion: string): Promise<BackupFile> {
  const stores: Record<string, unknown[]> = {};
  for (const n of DATA_STORES) stores[n] = await store.db.getAll(n);
  const data = {
    meta: { xp: await store.getXp(), preferences: await store.getMeta('preferences', null), lastPosition: await store.getMeta('lastPosition', null) },
    stores,
  };
  return { format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, contentVersion, exportedAt: new Date().toISOString(), app: 'bahad1-learning-app', data, checksum: sha256Hex(canonical(data)) };
}

export interface BackupCheck {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary?: { questionStats: number; lessonState: number; assessments: number; exams: number; masteredLessons: number; xp: number; exportedAt: string };
}

/** Validates an untrusted backup file BEFORE anything is written. */
export function validateBackup(raw: string, currentContentVersion: string): { check: BackupCheck; file?: BackupFile } {
  const errors: string[] = []; const warnings: string[] = [];
  let f: BackupFile;
  try { f = JSON.parse(raw) as BackupFile; } catch { return { check: { ok: false, errors: ['הקובץ אינו JSON תקין'], warnings } }; }
  if (!f || f.format !== BACKUP_FORMAT) errors.push('זה אינו קובץ גיבוי של האפליקציה');
  if (typeof f?.schemaVersion !== 'number') errors.push('חסרה גרסת מבנה');
  else if (f.schemaVersion > SCHEMA_VERSION) errors.push(`הגיבוי נוצר בגרסה חדשה יותר (${f.schemaVersion}) מזו שהאפליקציה תומכת בה (${SCHEMA_VERSION})`);
  if (!f?.data?.stores || typeof f.data.stores !== 'object') errors.push('מבנה הנתונים בגיבוי פגום');
  if (errors.length) return { check: { ok: false, errors, warnings } };
  for (const n of DATA_STORES) {
    if (!Array.isArray(f.data.stores[n])) errors.push(`חסר מאגר נתונים: ${n}`);
  }
  if (typeof f.checksum !== 'string' || sha256Hex(canonical(f.data)) !== f.checksum) errors.push('סכום הביקורת אינו תואם – הקובץ שונה או פגום');
  const ss = f.data.stores as Record<StoreName, any[]>;
  for (const s of ss.questionStats ?? []) if (typeof s?.questionId !== 'string' || typeof s?.seen !== 'number') { errors.push('רשומת סטטיסטיקה פגומה'); break; }
  for (const s of ss.lessonState ?? []) if (typeof s?.lessonId !== 'string') { errors.push('רשומת שיעור פגומה'); break; }
  if (f.contentVersion !== currentContentVersion) warnings.push(`גרסת התוכן בגיבוי (${f.contentVersion}) שונה מהנוכחית (${currentContentVersion}). רשומות של שאלות שהוסרו יישמרו אך לא יוצגו.`);
  if (errors.length) return { check: { ok: false, errors, warnings } };
  return {
    file: f,
    check: {
      ok: true, errors, warnings,
      summary: {
        questionStats: ss.questionStats.length, lessonState: ss.lessonState.length, assessments: ss.assessments.length, exams: ss.exams.length,
        masteredLessons: ss.lessonState.filter((l) => l.masteredAt).length, xp: f.data.meta?.xp ?? 0, exportedAt: f.exportedAt,
      },
    },
  };
}

/** Restores a validated backup. A safety snapshot of the CURRENT progress is stored first, so a wrong restore can be undone. */
export async function restoreBackup(store: ProgressStore, file: BackupFile, currentContentVersion: string): Promise<void> {
  const before = await buildBackup(store, currentContentVersion);
  await store.addSnapshot({ ts: Date.now(), reason: 'before-restore', payload: JSON.stringify(before) });
  await store.wipeData();
  const tx = store.db.transaction([...DATA_STORES] as StoreName[], 'readwrite');
  for (const n of DATA_STORES) {
    const os = tx.objectStore(n);
    for (const rec of file.data.stores[n] as any[]) await os.put(rec);
  }
  await tx.done;
  await store.setMeta('xp', file.data.meta?.xp ?? 0);
  if (file.data.meta?.preferences) await store.setMeta('preferences', file.data.meta.preferences);
  if (file.data.meta?.lastPosition) await store.setMeta('lastPosition', file.data.meta.lastPosition);
}

/** Daily automatic safety snapshot (kept inside IndexedDB, last 5). Exported files remain the real backup. */
export async function maybeAutoSnapshot(store: ProgressStore, contentVersion: string, today: string) {
  if ((await store.getMeta<string>('lastAutoSnapshot', '')) === today) return false;
  const b = await buildBackup(store, contentVersion);
  const hasData = Object.values(b.data.stores).some((a) => a.length > 0);
  if (!hasData) return false;
  await store.addSnapshot({ ts: Date.now(), reason: 'auto-daily', payload: JSON.stringify(b) });
  await store.setMeta('lastAutoSnapshot', today);
  return true;
}
