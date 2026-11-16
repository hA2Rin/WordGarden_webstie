export const STORAGE_KEY = 'word-garden:v1';
export const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function initialState() {
  return {version:1, downloaded:['daily'], favorites:['academic-1'], records:{}, events:[], active:null, lastResult:null, quiz:null};
}
export function readState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return initialState();
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.events) || !Array.isArray(data.downloaded) || !data.records || !Array.isArray(data.favorites)) throw new Error('저장된 기록을 읽을 수 없어요. 기존 데이터는 그대로 보존했어요.');
  return {...initialState(), ...data};
}
export function persist(storage, state) { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return state; }
export function newSession(setId, ids, mode='learn') {
  return {id:crypto.randomUUID(),setId,ids:[...ids],index:0,answers:[],mode,startedAt:new Date().toISOString()};
}
// 상태와 전송 대기 이벤트를 한 번의 저장으로 함께 기록합니다.
export function answerSession(state, status, date = new Date()) {
  const active = state.active;
  if (!active || active.index >= active.ids.length) return state;
  if (!['known','review'].includes(status)) throw new Error('Invalid learning response');
  const wordId = active.ids[active.index];
  const event = {id:crypto.randomUUID(),sessionId:active.id,wordId,status,occurredAt:date.toISOString(),day:localDay(date),source:'web'};
  const next = structuredClone(state);
  next.records[wordId] = {status,updatedAt:event.occurredAt};
  next.events.push(event);
  next.active.answers.push({wordId,status});
  next.active.index++;
  if (next.active.index === next.active.ids.length) { next.lastResult = structuredClone(next.active); next.active = null; }
  return next;
}
export function acknowledge(state, ids) {
  const accepted = new Set(ids);
  return {...state,events:state.events.map(event => accepted.has(event.id) ? {...event,syncedAt:new Date().toISOString()} : event)};
}
export const pendingEvents = state => state.events.filter(event => !event.syncedAt);
export function streak(state, now = new Date()) {
  const days = new Set(state.events.map(event => event.day));
  const cursor = new Date(now); let count = 0;
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate()-1);
  while (days.has(localDay(cursor))) { count++; cursor.setDate(cursor.getDate()-1); }
  return count;
}
