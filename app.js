'use strict';

/* =========================================================
 * 경영지원 업무 보드
 * - 데이터는 브라우저 localStorage에 저장 (서버 없음)
 * - 설정·백업 화면에서 JSON 백업/복원
 * ========================================================= */

const STORE_KEY = 'bizops-board-v1';

/* ---------- 유틸 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const won = (n) => `${Math.round(num(n)).toLocaleString('ko-KR')}원`;
const manwon = (n) => {
  const v = num(n);
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2).replace(/\.?0+$/, '')}억원`;
  if (Math.abs(v) >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
  return won(v);
};
const WD = ['일', '월', '화', '수', '목', '금', '토'];

function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const today = () => ymd(new Date());
function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5); }
const lastDay = (y, m) => new Date(y, m, 0).getDate();
function fmtDate(s) { return s ? `${s.replace(/-/g, '.')} (${WD[parseDate(s).getDay()]})` : ''; }
function shortDate(s) { return `${+s.slice(5, 7)}/${+s.slice(8)} (${WD[parseDate(s).getDay()]})`; }
function dday(s) { const n = diffDays(today(), s); return n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`; }
function ddayTone(s) { const n = diffDays(today(), s); return n < 0 ? 'danger' : n <= 3 ? 'warn' : n <= 7 ? 'info' : ''; }
/** 기준일의 다음 달 n일 (예: 4대보험 신고 = 다음 달 15일) */
function nextMonthDay(s, day) { const d = parseDate(s); const y = d.getMonth() === 11 ? d.getFullYear() + 1 : d.getFullYear(); const m = (d.getMonth() + 1) % 12 + 1; return `${y}-${pad(m)}-${pad(Math.min(day, lastDay(y, m)))}`; }
/** s 로부터 years 년 뒤 같은 날 (2/29 → 2/28 보정) */
function anniv(s, years) { const [y, m, d] = s.split('-').map(Number); const yy = y + years; return `${yy}-${pad(m)}-${pad(Math.min(d, lastDay(yy, m)))}`; }
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- 기본 공휴일 (설정에서 수정 가능) ---------- */
const DEFAULT_HOLIDAYS = `# 공휴일·대체공휴일 (YYYY-MM-DD 이름). 매년 확정 공고 후 확인·수정하세요.
2026-01-01 신정
2026-02-16 설날 연휴
2026-02-17 설날
2026-02-18 설날 연휴
2026-03-02 삼일절 대체공휴일
2026-05-05 어린이날
2026-05-25 부처님오신날 대체공휴일
2026-06-03 전국동시지방선거
2026-08-17 광복절 대체공휴일
2026-09-24 추석 연휴
2026-09-25 추석
2026-09-28 추석 대체공휴일
2026-10-05 개천절 대체공휴일
2026-10-09 한글날
2026-12-25 성탄절
2027-01-01 신정
2027-02-08 설날 연휴
2027-02-09 설날 대체공휴일
2027-03-01 삼일절
2027-05-05 어린이날
2027-05-13 부처님오신날
2027-08-16 광복절 대체공휴일
2027-09-14 추석 연휴
2027-09-15 추석
2027-09-16 추석 연휴
2027-10-04 개천절 대체공휴일
2027-10-11 한글날 대체공휴일
2027-12-27 성탄절 대체공휴일`;

/* ---------- 법정·정기 일정 규칙 (12월 결산 법인, 직원 고용 사업장 기준) ---------- */
// day: 숫자 | 'last'(말일) | 'payday'(설정의 급여일). 주말·공휴일이면 다음 영업일로 이월 (shift:'prev' 는 앞당김)
const RULES = [
  { id: 'wht', cat: '세무', months: 'all', day: 10, title: '원천세 신고·납부 (전월 지급분)', note: '홈택스 원천징수이행상황신고서. 반기납부 승인 사업장은 1·7월만' },
  { id: 'ins-pay', cat: '4대보험', months: 'all', day: 10, title: '4대보험료 납부 (전월분)', note: '건강·연금·고용·산재 고지액 확인 및 납부' },
  { id: 'etax', cat: '회계', months: 'all', day: 10, title: '월합계 전자세금계산서 발급 기한 (전월 거래분)' },
  { id: 'ins-report', cat: '4대보험', months: 'all', day: 15, title: '4대보험 취득·상실 신고 마감 (전월 입·퇴사자)', note: '사유 발생일이 속한 달의 다음 달 15일까지' },
  { id: 'payroll', cat: '인사', months: 'all', day: 'payday', shift: 'prev', title: '급여 지급 · 임금명세서 교부', note: '임금명세서 교부는 근로기준법상 의무' },
  { id: 'close', cat: '회계', months: 'all', day: 'last', title: '월 마감 (법인카드·증빙·전표 정리)' },
  { id: 'simple-biz', cat: '세무', months: 'all', day: 'last', title: '간이지급명세서 제출 (사업·기타소득 전월분)', note: '프리랜서(3.3%) 등 인적용역 지급이 있을 때' },
  { id: 'vat-2f', cat: '세무', months: [1], day: 25, title: '부가가치세 2기 확정신고·납부' },
  { id: 'vat-1p', cat: '세무', months: [4], day: 25, title: '부가가치세 1기 예정신고·납부', note: '직전 과세기간 공급가액 1.5억원 미만 법인은 예정고지 납부' },
  { id: 'vat-1f', cat: '세무', months: [7], day: 25, title: '부가가치세 1기 확정신고·납부' },
  { id: 'vat-2p', cat: '세무', months: [10], day: 25, title: '부가가치세 2기 예정신고·납부', note: '직전 과세기간 공급가액 1.5억원 미만 법인은 예정고지 납부' },
  { id: 'ye-open', cat: '인사', months: [1], day: 15, title: '연말정산 간소화자료 개시 — 직원 안내·자료 수집' },
  { id: 'nonwage', cat: '세무', months: [2], day: 'last', title: '이자·배당·기타소득 지급명세서 제출 (해당 시)' },
  { id: 'ye-file', cat: '세무', months: [3], day: 10, title: '연말정산 신고 · 근로/퇴직/사업소득 지급명세서 제출' },
  { id: 'ins-total-h', cat: '4대보험', months: [3], day: 10, title: '건강보험 보수총액 신고' },
  { id: 'ins-total-e', cat: '4대보험', months: [3], day: 15, title: '고용·산재보험 보수총액 신고' },
  { id: 'cit', cat: '세무', months: [3], day: 31, title: '법인세 신고·납부 (12월 결산)' },
  { id: 'lit', cat: '세무', months: [4], day: 30, title: '법인지방소득세 신고·납부' },
  { id: 'jumin', cat: '세무', months: [8], day: 31, title: '주민세 사업소분 신고·납부' },
  { id: 'cit-mid', cat: '세무', months: [8], day: 31, title: '법인세 중간예납 (해당 시)', note: '직전 사업연도 법인세 산출세액 기준. 중소기업은 50만원 미만 시 면제' },
  { id: 'edu', cat: '인사', months: [11], day: 30, title: '법정의무교육 연내 이수 점검', note: '직장 내 성희롱 예방 · 개인정보보호 · 장애인 인식개선 · 퇴직연금(가입 시) · 산업안전보건(해당 시)' },
  { id: 'salary-next', cat: '인사', months: [12], day: 15, title: '차년도 최저임금 반영 · 연봉/근로계약 갱신 검토' },
];

const CAT_CLASS = { 세무: 'c1', '4대보험': 'c2', 인사: 'c3', 휴가: 'c3', 총무: 'c4', 회계: 'c5', 정부지원: 'c6', '할 일': 'c7', 기타: 'c8' };
const catClass = (c) => CAT_CLASS[c] || 'c8';

/* ---------- 선택지 ---------- */
const OPT = {
  cat: ['인사', '총무', '회계', '세무', '4대보험', '정부지원', '기타'],
  account: ['복리후생비', '여비교통비', '기업업무추진비(접대비)', '통신비', '소모품비', '지급수수료', '임차료', '도서인쇄비', '교육훈련비', '광고선전비', '차량유지비', '세금과공과', '보험료', '외주용역비', '연구개발비', '비품(자산)', '기타'],
  payMethod: ['법인카드', '계좌이체', '현금', '개인카드(정산)', '자동이체'],
  evidence: ['세금계산서', '계산서', '카드전표', '현금영수증', '간이영수증', '없음'],
};
const QUALIFIED_EVIDENCE = ['세금계산서', '계산서', '카드전표', '현금영수증'];

/* ---------- 엔터티 스키마 ---------- */
// t: text | date | money | number | select | textarea | check | url
const SCHEMA = {
  todos: {
    name: '할 일',
    fields: [
      { k: 'title', l: '제목', t: 'text', req: 1, wide: 1 },
      { k: 'category', l: '분류', t: 'select', o: OPT.cat, d: '기타' },
      { k: 'due', l: '마감일', t: 'date' },
      { k: 'priority', l: '우선순위', t: 'select', o: ['높음', '보통', '낮음'], d: '보통', badge: 1 },
      { k: 'status', l: '상태', t: 'select', o: ['대기', '진행', '완료'], d: '대기', badge: 1 },
      { k: 'memo', l: '메모', t: 'textarea', wide: 1 },
    ],
    cols: ['done', 'due', 'category', 'title', 'priority', 'status'],
  },
  employees: {
    name: '직원',
    fields: [
      { k: 'name', l: '이름', t: 'text', req: 1 },
      { k: 'dept', l: '부서', t: 'text' },
      { k: 'position', l: '직급/직책', t: 'text' },
      { k: 'empType', l: '고용형태', t: 'select', o: ['정규직', '계약직', '인턴', '파트타임', '프리랜서'], d: '정규직' },
      { k: 'status', l: '재직상태', t: 'select', o: ['재직', '휴직', '퇴사'], d: '재직', badge: 1 },
      { k: 'hireDate', l: '입사일', t: 'date', req: 1 },
      { k: 'probationEnd', l: '수습 종료일', t: 'date' },
      { k: 'leaveDate', l: '퇴사일', t: 'date' },
      { k: 'birth', l: '생년월일', t: 'date' },
      { k: 'email', l: '이메일', t: 'text' },
      { k: 'insured', l: '4대보험', t: 'check', cl: '취득신고 완료' },
      { k: 'contract', l: '근로계약서', t: 'check', cl: '작성·교부 완료' },
      { k: 'memo', l: '메모', t: 'textarea', wide: 1, h: '주민등록번호·계좌번호 등 민감정보는 입력하지 마세요.' },
    ],
    cols: ['name', 'dept', 'position', 'empType', 'status', 'hireDate', 'tenure', 'annual', 'checks'],
    validate: (d) => (d.leaveDate && d.hireDate && d.leaveDate < d.hireDate ? '퇴사일이 입사일보다 빠릅니다.' : ''),
  },
  leaves: {
    name: '휴가',
    fields: [
      { k: 'employeeId', l: '직원', t: 'select', req: 1, o: () => state.employees.map((e) => [e.id, e.name]) },
      { k: 'type', l: '종류', t: 'select', o: ['연차', '반차', '반반차', '병가', '경조사', '공가', '기타'], d: '연차' },
      { k: 'start', l: '시작일', t: 'date', req: 1 },
      { k: 'end', l: '종료일', t: 'date', h: '비우면 시작일과 같음' },
      { k: 'days', l: '사용일수', t: 'number', h: '비우면 영업일 기준 자동 계산 (반차 0.5, 반반차 0.25)' },
      { k: 'memo', l: '메모', t: 'text' },
    ],
    cols: ['start', 'end', 'employeeId', 'type', 'days', 'memo'],
    validate: (d) => (d.end && d.end < d.start ? '종료일이 시작일보다 빠릅니다.' : ''),
    beforeSave: (d) => {
      if (!d.end) d.end = d.start;
      if (d.days === '' || d.days == null) {
        if (d.type === '반차') d.days = 0.5;
        else if (d.type === '반반차') d.days = 0.25;
        else d.days = businessDays(d.start, d.end);
      }
    },
  },
  expenses: {
    name: '지출',
    fields: [
      { k: 'date', l: '사용일', t: 'date', req: 1, d: () => today() },
      { k: 'account', l: '계정과목', t: 'select', o: OPT.account, d: '복리후생비' },
      { k: 'vendor', l: '거래처', t: 'text' },
      { k: 'desc', l: '내용', t: 'text', req: 1 },
      { k: 'amount', l: '금액(부가세 포함)', t: 'money', req: 1 },
      { k: 'method', l: '결제수단', t: 'select', o: OPT.payMethod, d: '법인카드' },
      { k: 'evidence', l: '증빙', t: 'select', o: OPT.evidence, d: '카드전표' },
      { k: 'grantId', l: '지원사업 집행', t: 'select', o: () => state.grants.map((g) => [g.id, g.name]), h: '정부지원사업비로 집행한 경우 선택' },
      { k: 'settled', l: '정산', t: 'check', cl: '전표 처리·정산 완료' },
      { k: 'memo', l: '메모', t: 'text', wide: 1 },
    ],
    cols: ['date', 'account', 'vendor', 'desc', 'amount', 'method', 'evidence', 'grantId', 'flag'],
  },
  grants: {
    name: '정부지원사업',
    fields: [
      { k: 'name', l: '사업명', t: 'text', req: 1, wide: 1 },
      { k: 'agency', l: '주관·전담기관', t: 'text' },
      { k: 'program', l: '유형', t: 'select', o: ['R&D', '사업화·창업', '고용지원', '바우처', '수출·마케팅', '인증·컨설팅', '기타'], d: '사업화·창업' },
      { k: 'status', l: '진행상태', t: 'select', o: ['공고검토', '신청준비', '신청완료', '선정', '협약·수행중', '정산중', '완료', '미선정'], d: '공고검토', badge: 1 },
      { k: 'manager', l: '담당자', t: 'text' },
      { k: 'applyDue', l: '신청 마감일', t: 'date' },
      { k: 'start', l: '협약 시작일', t: 'date' },
      { k: 'end', l: '협약 종료일', t: 'date' },
      { k: 'govFund', l: '정부지원금', t: 'money' },
      { k: 'selfCash', l: '자부담(현금)', t: 'money' },
      { k: 'selfInKind', l: '자부담(현물)', t: 'money' },
      { k: 'interimDue', l: '중간보고 기한', t: 'date' },
      { k: 'finalDue', l: '최종보고 기한', t: 'date' },
      { k: 'settleDue', l: '정산 마감일', t: 'date' },
      { k: 'url', l: '공고/시스템 링크', t: 'url', wide: 1 },
      { k: 'memo', l: '메모', t: 'textarea', wide: 1 },
    ],
    validate: (d) => (d.start && d.end && d.end < d.start ? '협약 종료일이 시작일보다 빠릅니다.' : ''),
  },
  assets: {
    name: '자산·비품',
    fields: [
      { k: 'name', l: '품목명', t: 'text', req: 1 },
      { k: 'kind', l: '분류', t: 'select', o: ['노트북·PC', '모니터', '주변기기', '모바일', '소프트웨어 라이선스', '가구', '기타'], d: '노트북·PC' },
      { k: 'serial', l: '관리번호/시리얼', t: 'text' },
      { k: 'assignee', l: '사용자', t: 'select', o: () => state.employees.filter((e) => e.status !== '퇴사').map((e) => [e.id, e.name]) },
      { k: 'purchaseDate', l: '구입일', t: 'date' },
      { k: 'price', l: '구입가', t: 'money' },
      { k: 'status', l: '상태', t: 'select', o: ['사용중', '보관', '수리중', '폐기'], d: '사용중', badge: 1 },
      { k: 'memo', l: '메모', t: 'text', wide: 1 },
    ],
    cols: ['name', 'kind', 'serial', 'assignee', 'purchaseDate', 'price', 'status'],
  },
  contracts: {
    name: '계약·구독',
    fields: [
      { k: 'name', l: '계약명', t: 'text', req: 1 },
      { k: 'counterparty', l: '상대방', t: 'text' },
      { k: 'kind', l: '유형', t: 'select', o: ['사무실 임대차', 'SaaS·구독', '용역·외주', '보험', '리스·렌탈', '고객 계약', '기타'], d: 'SaaS·구독' },
      { k: 'start', l: '시작일', t: 'date' },
      { k: 'end', l: '종료(만료)일', t: 'date' },
      { k: 'amount', l: '금액', t: 'money' },
      { k: 'cycle', l: '지급주기', t: 'select', o: ['월', '연', '일시'], d: '월' },
      { k: 'noticeDays', l: '해지·갱신 통보(만료 며칠 전)', t: 'number' },
      { k: 'autoRenew', l: '자동갱신', t: 'check', cl: '자동갱신 계약' },
      { k: 'memo', l: '메모', t: 'text', wide: 1 },
    ],
    cols: ['name', 'kind', 'counterparty', 'end', 'remain', 'amount', 'cycle', 'monthly', 'autoRenew'],
    validate: (d) => (d.start && d.end && d.end < d.start ? '종료일이 시작일보다 빠릅니다.' : ''),
  },
  customRules: {
    name: '반복 일정',
    fields: [
      { k: 'title', l: '일정명', t: 'text', req: 1, wide: 1 },
      { k: 'cat', l: '분류', t: 'select', o: OPT.cat, d: '기타' },
      { k: 'months', l: '월', t: 'text', d: '매월', h: '"매월" 또는 "1,4,7,10" 처럼 입력' },
      { k: 'day', l: '일', t: 'text', d: '10', h: '숫자 또는 "말일"' },
      { k: 'note', l: '설명', t: 'text', wide: 1 },
    ],
    cols: ['title', 'cat', 'months', 'day', 'note'],
  },
};

const DEFAULTS = {
  version: 1,
  settings: { company: '제로스트에이아이', payday: 25, lookahead: 45, holidays: DEFAULT_HOLIDAYS, theme: 'auto', lastBackup: '', since: '' },
  todos: [], employees: [], leaves: [], expenses: [], grants: [], assets: [], contracts: [], customRules: [],
  done: {},
};

/* ---------- 저장 ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* 저장소 사용 불가 → 기본값 */ }
  return structuredClone(DEFAULTS);
}
function normalize(s) {
  const d = structuredClone(DEFAULTS);
  if (!s || typeof s !== 'object') return d;
  for (const k of Object.keys(d)) {
    if (s[k] === undefined) continue;
    if (k === 'settings') d.settings = { ...d.settings, ...s.settings };
    else if (Array.isArray(d[k])) d[k] = Array.isArray(s[k]) ? s[k] : [];
    else d[k] = s[k];
  }
  return d;
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('저장 실패: 설정·백업에서 JSON으로 내보내 보관하세요.'); }
}

let state = load();
// 사용 시작일 이전의 법정 일정은 '기한 지남'으로 띄우지 않음
if (!state.settings.since) { state.settings.since = today(); save(); }
const ui = {
  calMonth: today().slice(0, 7),
  hrTab: 'employees', adminTab: 'contracts',
  todoStatus: 'open', todoQ: '',
  expMonth: today().slice(0, 7), expGrant: '', expQ: '',
  leaveEmp: '', empQ: '', showRetired: false,
};

/* ---------- 공휴일·영업일 ---------- */
function holidayMap() {
  const map = new Map();
  for (const line of String(state.settings.holidays || '').split('\n')) {
    const m = line.match(/^\s*(\d{4}-\d{2}-\d{2})\s*(.*)$/);
    if (m) map.set(m[1], m[2].trim() || '공휴일');
  }
  return map;
}
function isOff(s, hs) { const w = parseDate(s).getDay(); return w === 0 || w === 6 || hs.has(s); }
function shiftBiz(s, dir, hs) { let guard = 0; while (isOff(s, hs) && guard++ < 20) s = addDays(s, dir); return s; }
function businessDays(from, to) {
  const hs = holidayMap(); let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isOff(d, hs)) n++;
  return n;
}

/* ---------- 일정 생성 ---------- */
function parseMonths(t) {
  t = String(t || '').trim();
  if (!t || /매월|all/i.test(t)) return 'all';
  return t.split(/[,\s/]+/).map(Number).filter((n) => n >= 1 && n <= 12);
}
function allRules() {
  return [
    ...RULES,
    ...state.customRules.map((r) => ({ id: `c-${r.id}`, title: r.title, cat: r.cat || '기타', months: parseMonths(r.months), day: /말/.test(r.day) ? 'last' : num(r.day), note: r.note })),
  ];
}
function ruleDate(rule, y, m, hs) {
  let day = rule.day === 'payday' ? num(state.settings.payday) || 25 : rule.day;
  const dd = day === 'last' || day >= lastDay(y, m) ? lastDay(y, m) : day;
  if (!dd) return null;
  return shiftBiz(`${y}-${pad(m)}-${pad(dd)}`, rule.shift === 'prev' ? -1 : 1, hs);
}
function ruleEvents(from, to) {
  const hs = holidayMap(); const out = []; const rules = allRules();
  const f = parseDate(from); const end = parseDate(to);
  // 주말·공휴일 이월로 범위 안에 들어올 수 있어 한 달 앞부터 계산
  for (let c = new Date(f.getFullYear(), f.getMonth() - 1, 1); c <= end; c = new Date(c.getFullYear(), c.getMonth() + 1, 1)) {
    const y = c.getFullYear(); const m = c.getMonth() + 1;
    for (const r of rules) {
      if (r.months !== 'all' && !r.months.includes(m)) continue;
      const date = ruleDate(r, y, m, hs);
      if (!date || date < from || date > to) continue;
      const key = `${r.id}@${y}-${pad(m)}`;
      out.push({ date, title: r.title, cat: r.cat, note: r.note, key, kind: 'rule', done: !!state.done[key] });
    }
  }
  return out;
}
const empName = (id) => state.employees.find((e) => e.id === id)?.name || '(삭제된 직원)';

function allEvents(from, to) {
  const inR = (s) => s && s >= from && s <= to;
  const ev = ruleEvents(from, to);
  for (const t of state.todos) if (inR(t.due)) ev.push({ date: t.due, title: t.title, cat: t.category || '할 일', kind: 'todo', id: t.id, done: t.status === '완료' });
  for (const g of state.grants) {
    if (g.status === '미선정') continue;
    for (const [k, l] of [['applyDue', '신청 마감'], ['interimDue', '중간보고'], ['finalDue', '최종보고'], ['settleDue', '정산 마감'], ['end', '협약 종료']]) {
      if (inR(g[k])) ev.push({ date: g[k], title: `[${g.name}] ${l}`, cat: '정부지원', kind: 'grant', done: g.status === '완료' || (k === 'applyDue' && !['공고검토', '신청준비'].includes(g.status)) });
    }
  }
  for (const c of state.contracts) {
    if (inR(c.end)) ev.push({ date: c.end, title: `${c.name} 계약 만료${c.autoRenew ? ' (자동갱신)' : ''}`, cat: '총무', kind: 'contract' });
    if (c.end && num(c.noticeDays) > 0) {
      const n = addDays(c.end, -num(c.noticeDays));
      if (inR(n)) ev.push({ date: n, title: `${c.name} 해지·갱신 통보 기한`, cat: '총무', kind: 'contract' });
    }
  }
  for (const e of state.employees) {
    if (e.status === '퇴사') continue;
    if (inR(e.probationEnd)) ev.push({ date: e.probationEnd, title: `${e.name} 수습 종료 — 평가·본채용 확정`, cat: '인사', kind: 'hr' });
    if (e.hireDate) {
      const hy = +e.hireDate.slice(0, 4);
      for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
        const a = anniv(e.hireDate, y - hy);
        if (y > hy && inR(a)) ev.push({ date: a, title: `${e.name} 입사 ${y - hy}주년 (연차 신규 발생)`, cat: '인사', kind: 'hr' });
      }
    }
  }
  const hs = holidayMap();
  for (const l of state.leaves) {
    if (!l.start) continue;
    const end = l.end || l.start;
    if (end < from || l.start > to) continue;
    let first = true;
    for (let d = l.start > from ? l.start : from; d <= end && d <= to; d = addDays(d, 1)) {
      if (isOff(d, hs)) continue;
      ev.push({ date: d, title: `${empName(l.employeeId)} ${l.type}${end !== l.start ? ` (~${shortDate(end)})` : ''}`, cat: '휴가', kind: 'leave', first });
      first = false;
    }
  }
  return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'rule' ? -1 : 1));
}

/* ---------- 연차 계산 (근로기준법 제60조, 입사일 기준) ---------- */
function leaveInfo(e, asOf = today()) {
  if (!e.hireDate || e.hireDate > asOf) return null;
  const h = parseDate(e.hireDate); const a = parseDate(asOf);
  let months = (a.getFullYear() - h.getFullYear()) * 12 + (a.getMonth() - h.getMonth());
  if (a.getDate() < h.getDate()) months--;
  const years = Math.floor(months / 12);
  let granted; let periodStart; let periodEnd;
  if (years < 1) {
    granted = Math.min(months, 11); periodStart = e.hireDate; periodEnd = addDays(anniv(e.hireDate, 1), -1);
  } else {
    granted = Math.min(15 + Math.floor((years - 1) / 2), 25);
    periodStart = anniv(e.hireDate, years); periodEnd = addDays(anniv(e.hireDate, years + 1), -1);
  }
  const used = state.leaves
    .filter((l) => l.employeeId === e.id && ['연차', '반차', '반반차'].includes(l.type) && l.start >= periodStart && l.start <= periodEnd)
    .reduce((s, l) => s + num(l.days), 0);
  return { years, months, granted, used, remain: granted - used, periodStart, periodEnd };
}
function tenure(e) {
  if (!e.hireDate) return '';
  const end = e.status === '퇴사' && e.leaveDate ? e.leaveDate : today();
  if (end < e.hireDate) return '입사 예정';
  const h = parseDate(e.hireDate); const a = parseDate(end);
  let m = (a.getFullYear() - h.getFullYear()) * 12 + (a.getMonth() - h.getMonth());
  if (a.getDate() < h.getDate()) m--;
  return m >= 12 ? `${Math.floor(m / 12)}년 ${m % 12}개월` : `${m}개월`;
}

/* ---------- 지출·지원사업 계산 ---------- */
function expenseFlag(x) {
  if (num(x.amount) > 30000 && !QUALIFIED_EVIDENCE.includes(x.evidence)) {
    return x.account?.startsWith('기업업무추진비') ? '적격증빙 없음 → 손금불산입 위험' : '3만원 초과 적격증빙 필요';
  }
  if (x.method === '개인카드(정산)' && !x.settled) return '개인카드 정산 필요';
  return '';
}
function grantStats(g) {
  const exec = state.expenses.filter((x) => x.grantId === g.id).reduce((s, x) => s + num(x.amount), 0);
  const budget = num(g.govFund) + num(g.selfCash);
  return { exec, budget, rate: budget ? exec / budget : 0 };
}
function monthlyCost(c) {
  if (c.cycle === '월') return num(c.amount);
  if (c.cycle === '연') return num(c.amount) / 12;
  return 0;
}
const contractActive = (c) => !c.end || c.end >= today();

/* ---------- 표시 헬퍼 ---------- */
const TONE = {
  완료: 'ok', 재직: 'ok', 선정: 'ok', 사용중: 'ok', '협약·수행중': 'info', 진행: 'info', 신청완료: 'info',
  정산중: 'warn', 휴직: 'warn', 수리중: 'warn', 높음: 'danger', 신청준비: 'info',
};
const badge = (label, tone) => `<span class="badge ${tone ?? TONE[label] ?? ''}">${esc(label)}</span>`;
function opts(f) { return (typeof f.o === 'function' ? f.o() : f.o || []).map((o) => (Array.isArray(o) ? o : [o, o])); }
function optLabel(f, v) { return opts(f).find(([k]) => String(k) === String(v))?.[1] ?? (typeof f.o === 'function' ? '(삭제됨)' : v); }
function cellHtml(f, v) {
  if (v === '' || v == null || v === false) return '<span class="muted">-</span>';
  switch (f.t) {
    case 'date': return esc(fmtDate(v));
    case 'money': return esc(won(v));
    case 'check': return '✓';
    case 'select': { const l = optLabel(f, v); return f.badge ? badge(l) : esc(l); }
    case 'url': return `<a href="${esc(safeUrl(v))}" target="_blank" rel="noopener">열기</a>`;
    default: return esc(v);
  }
}
function table(ent, rows, { cols, extra = {}, rowClass, empty = '아직 등록된 항목이 없습니다.', foot } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const S = SCHEMA[ent];
  const defs = (cols || S.cols).map((c) => (extra[c] ? { k: c, ...extra[c] } : S.fields.find((f) => f.k === c)));
  const isNum = (d) => d.t === 'money' || d.t === 'number' || d.num;
  return `<div class="table-wrap"><table>
    <thead><tr>${defs.map((d) => `<th class="${isNum(d) ? 'num' : ''}">${esc(d.l)}</th>`).join('')}<th class="act"><span class="sr">편집</span></th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${rowClass?.(r) || ''}">${defs.map((d) => `<td class="${isNum(d) ? 'num' : ''}">${d.f ? d.f(r) : cellHtml(d, r[d.k])}</td>`).join('')}
      <td class="act"><button class="btn sm ghost" data-act="edit" data-ent="${ent}" data-id="${r.id}">수정</button></td></tr>`).join('')}</tbody>
    ${foot ? `<tfoot>${foot(defs)}</tfoot>` : ''}
  </table></div>`;
}
const matchQ = (r, q, extra = '') => !q || (Object.values(r).join(' ') + ' ' + extra).toLowerCase().includes(q.toLowerCase());
const head = (title, desc, actions = '') => `<div class="page-head"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="toolbar">${actions}</div></div>`;
const addBtn = (ent, label, preset) => `<button class="btn primary" data-act="add" data-ent="${ent}"${preset ? ` data-preset='${esc(JSON.stringify(preset))}'` : ''}>+ ${label}</button>`;

function evRow(e) {
  const ctl = e.kind === 'rule'
    ? `<input type="checkbox" data-act="rule-done" data-key="${esc(e.key)}" ${e.done ? 'checked' : ''} aria-label="완료 표시">`
    : e.kind === 'todo'
      ? `<input type="checkbox" data-act="todo-done" data-id="${e.id}" ${e.done ? 'checked' : ''} aria-label="완료 표시">`
      : '<span class="dot"></span>';
  return `<li class="ev ${e.done ? 'done' : ''}">${ctl}<span class="ev-date">${shortDate(e.date)}</span><span class="chip ${catClass(e.cat)}">${esc(e.cat)}</span>
    <span class="ev-title">${esc(e.title)}${e.note ? `<small>${esc(e.note)}</small>` : ''}</span>
    <span class="dday ${e.done ? '' : ddayTone(e.date)}">${e.done ? '완료' : dday(e.date)}</span></li>`;
}

/* =========================================================
 * 화면
 * ========================================================= */
const VIEWS = {};

VIEWS.dashboard = () => {
  const t = today(); const s = state.settings; const ahead = num(s.lookahead) || 45;
  const active = state.employees.filter((e) => e.status !== '퇴사');
  const ym = t.slice(0, 7);
  const monthExp = state.expenses.filter((x) => x.date?.startsWith(ym)).reduce((a, x) => a + num(x.amount), 0);
  const running = state.grants.filter((g) => ['선정', '협약·수행중', '정산중'].includes(g.status));
  const openTodos = state.todos.filter((x) => x.status !== '완료');
  const lateTodos = openTodos.filter((x) => x.due && x.due < t);

  const evs = allEvents(addDays(t, -30), addDays(t, ahead));
  const overdue = evs.filter((e) => e.date < t && !e.done && (e.kind === 'todo' || (e.kind === 'rule' && e.date >= (s.since || t))));
  const upcoming = evs.filter((e) => e.date >= t && (e.kind !== 'leave' || e.first));

  const alerts = [];
  const flagged = state.expenses.filter((x) => expenseFlag(x));
  if (flagged.length) alerts.push(['warn', `증빙·정산 확인이 필요한 지출 <b>${flagged.length}건</b>`, '#accounting', '회계 보기']);
  for (const c of state.contracts) {
    if (c.end && c.end >= t && diffDays(t, c.end) <= 60) alerts.push([diffDays(t, c.end) <= 14 ? 'danger' : 'warn', `<b>${esc(c.name)}</b> 계약 만료 ${dday(c.end)} (${fmtDate(c.end)})${c.autoRenew ? ' · 자동갱신' : ''}`, '#admin', '총무 보기']);
  }
  for (const g of running) {
    const st = grantStats(g);
    if (g.end && g.end >= t && diffDays(t, g.end) <= 60 && st.budget && st.rate < 0.7) {
      alerts.push(['warn', `<b>${esc(g.name)}</b> 종료 ${dday(g.end)}인데 집행률 ${(st.rate * 100).toFixed(0)}%`, '#grants', '지원사업 보기']);
    }
  }
  for (const e of active) {
    const li = leaveInfo(e);
    if (li && li.years >= 1 && li.remain >= 5 && diffDays(t, li.periodEnd) <= 90) {
      alerts.push(['', `<b>${esc(e.name)}</b> 미사용 연차 ${li.remain}일 (${fmtDate(li.periodEnd)} 소멸) — 연차 사용 촉진 검토`, '#hr', '인사 보기']);
    }
    if (!e.contract && e.status === '재직') alerts.push(['danger', `<b>${esc(e.name)}</b> 근로계약서 작성·교부 미확인`, '#hr', '인사 보기']);
    if (!e.insured && e.status === '재직' && e.empType !== '프리랜서') alerts.push(['warn', `<b>${esc(e.name)}</b> 4대보험 취득신고 미확인`, '#hr', '인사 보기']);
  }
  const hasData = ['todos', 'employees', 'expenses', 'grants', 'contracts', 'assets'].some((k) => state[k].length);
  if (hasData && (!s.lastBackup || diffDays(s.lastBackup, t) > 14)) {
    alerts.push(['warn', s.lastBackup ? `마지막 백업이 ${diffDays(s.lastBackup, t)}일 전입니다.` : '아직 백업한 적이 없습니다.', '#settings', '백업하기']);
  }

  const d = parseDate(t);
  return `
    ${head(`${d.getMonth() + 1}월 ${d.getDate()}일 (${WD[d.getDay()]}) 업무 현황`, `${esc(s.company)} 경영지원 — 오늘부터 ${ahead}일간 일정과 확인할 사항`,
      `${addBtn('todos', '할 일')}<button class="btn" data-act="add" data-ent="expenses">+ 지출</button>`)}
    ${hasData ? '' : `<section class="card welcome"><h2>처음 오셨네요 👋</h2>
      <p>세무·4대보험·연말정산 등 법정 일정은 이미 자동으로 들어가 있습니다. 직원·계약·지원사업을 등록하면 연차, 계약 만료, 보고 기한도 함께 표시됩니다.</p>
      <div class="toolbar"><a class="btn primary" href="#hr">직원 등록하기</a><button class="btn" data-act="sample">샘플 데이터로 둘러보기</button></div></section><br>`}
    <div class="kpis">
      <div class="card kpi"><div class="label">재직 인원</div><div class="value">${active.filter((e) => e.status === '재직').length}명</div><div class="sub">휴직 ${active.filter((e) => e.status === '휴직').length}명</div></div>
      <div class="card kpi"><div class="label">${+ym.slice(5)}월 지출</div><div class="value">${manwon(monthExp)}</div><div class="sub">${state.expenses.filter((x) => x.date?.startsWith(ym)).length}건</div></div>
      <div class="card kpi"><div class="label">진행 중 지원사업</div><div class="value">${running.length}건</div><div class="sub">신청 준비 ${state.grants.filter((g) => ['공고검토', '신청준비'].includes(g.status)).length}건</div></div>
      <div class="card kpi"><div class="label">미완료 할 일</div><div class="value">${openTodos.length}건</div><div class="sub ${lateTodos.length ? 'danger' : ''}">기한 지남 ${lateTodos.length}건</div></div>
    </div>
    <div class="grid grid-2">
      <section class="card">
        <div class="card-head"><h2>다가오는 일정 <span class="count">${upcoming.length}</span></h2><a href="#calendar">달력 보기</a></div>
        ${overdue.length ? `<div class="section-label">기한 지남 · 미완료 ${overdue.length}건</div><ul class="ev-list">${overdue.map(evRow).join('')}</ul><br>` : ''}
        ${upcoming.length ? `<ul class="ev-list">${upcoming.slice(0, 30).map(evRow).join('')}</ul>` : '<div class="empty">예정된 일정이 없습니다.</div>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>확인 필요 <span class="count">${alerts.length}</span></h2></div>
        ${alerts.length ? `<ul class="alerts">${alerts.map(([tone, msg, href, l]) => `<li class="${tone}"><span class="msg">${msg}</span><a href="${href}">${l}</a></li>`).join('')}</ul>` : '<div class="empty">확인할 사항이 없습니다. 👍</div>'}
        <div class="note">법정 일정은 <b>12월 결산 법인·직원 고용 사업장</b> 기준이며 주말·공휴일은 다음 영업일로 이월해 표시합니다. 회사 상황에 맞지 않는 항목은 체크해 두거나, 설정에서 반복 일정을 추가하세요.</div>
      </section>
    </div>`;
};

VIEWS.calendar = () => {
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = `${y}-${pad(m)}-01`; const last = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  const gridStart = addDays(first, -parseDate(first).getDay());
  const gridEnd = addDays(last, 6 - parseDate(last).getDay());
  const evs = allEvents(gridStart, gridEnd);
  const byDate = {};
  for (const e of evs) (byDate[e.date] ||= []).push(e);
  const hm = holidayMap(); const t = today();
  let cells = WD.map((w, i) => `<div class="wd ${i === 0 ? 'sun' : ''}">${w}</div>`).join('');
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const items = byDate[d] || [];
    cells += `<div class="day ${d.slice(0, 7) !== ui.calMonth ? 'out' : ''} ${isOff(d, hm) && parseDate(d).getDay() !== 6 ? 'off' : ''} ${d === t ? 'today' : ''}">
      <span class="n">${+d.slice(8)}</span>${hm.has(d) ? `<span class="hname">${esc(hm.get(d))}</span>` : ''}
      ${items.slice(0, 4).map((e) => `<span class="item ${catClass(e.cat)} ${e.done ? 'done' : ''}" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}
      ${items.length > 4 ? `<small>+${items.length - 4}</small>` : ''}</div>`;
  }
  const monthEvs = evs.filter((e) => e.date >= first && e.date <= last);
  return `
    ${head(`${y}년 ${m}월`, '법정 신고·납부, 할 일, 지원사업 보고, 계약 만료, 휴가를 한 달력에 모아 봅니다.',
      `<button class="btn" data-act="cal" data-d="-1" aria-label="이전 달">‹ 이전</button><button class="btn" data-act="cal" data-d="0">이번 달</button><button class="btn" data-act="cal" data-d="1" aria-label="다음 달">다음 ›</button>`)}
    <section class="card"><div class="cal">${cells}</div></section>
    <section class="card"><div class="card-head"><h2>${m}월 일정 목록 <span class="count">${monthEvs.length}</span></h2><button class="btn sm" onclick="window.print()">인쇄</button></div>
      ${monthEvs.length ? `<ul class="ev-list">${monthEvs.map(evRow).join('')}</ul>` : '<div class="empty">이번 달 일정이 없습니다.</div>'}</section>`;
};

VIEWS.todos = () => {
  let rows = state.todos.filter((r) => matchQ(r, ui.todoQ));
  if (ui.todoStatus === 'open') rows = rows.filter((r) => r.status !== '완료');
  if (ui.todoStatus === 'done') rows = rows.filter((r) => r.status === '완료');
  const pr = { 높음: 0, 보통: 1, 낮음: 2 };
  rows.sort((a, b) => (a.status === '완료') - (b.status === '완료') || (a.due || '9999').localeCompare(b.due || '9999') || pr[a.priority] - pr[b.priority]);
  const t = today();
  return `
    ${head('할 일', '분류·마감일·우선순위로 업무를 관리합니다. 체크하면 완료 처리됩니다.', addBtn('todos', '할 일'))}
    <section class="card">
      <div class="card-head">
        <div class="toolbar">
          <select data-filter="todoStatus" aria-label="상태">
            ${[['open', '미완료'], ['done', '완료'], ['all', '전체']].map(([v, l]) => `<option value="${v}" ${ui.todoStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <input id="todoQ" class="search" type="search" placeholder="검색" value="${esc(ui.todoQ)}" data-filter="todoQ">
        </div>
        <button class="btn sm" data-act="csv" data-ent="todos">CSV 내보내기</button>
      </div>
      ${table('todos', rows, {
        rowClass: (r) => (r.status === '완료' ? 'is-done' : r.due && r.due < t ? 'is-warn' : ''),
        extra: {
          done: { l: '', f: (r) => `<input type="checkbox" data-act="todo-done" data-id="${r.id}" ${r.status === '완료' ? 'checked' : ''} aria-label="완료">` },
          title: { l: '제목', f: (r) => `<span class="title-cell">${esc(r.title)}</span>${r.memo ? `<br><small>${esc(r.memo)}</small>` : ''}` },
          due: { l: '마감일', f: (r) => (r.due ? `${esc(fmtDate(r.due))} ${r.status !== '완료' ? `<span class="dday ${ddayTone(r.due)}">${dday(r.due)}</span>` : ''}` : '<span class="muted">-</span>') },
        },
        empty: ui.todoStatus === 'open' ? '미완료 할 일이 없습니다.' : '할 일이 없습니다.',
      })}
    </section>`;
};

VIEWS.hr = () => {
  const tabs = [['employees', '직원 명부'], ['leaves', '연차·휴가'], ['guide', '입·퇴사 가이드']];
  let body = '';
  if (ui.hrTab === 'employees') {
    const rows = state.employees
      .filter((e) => (ui.showRetired || e.status !== '퇴사') && matchQ(e, ui.empQ))
      .sort((a, b) => (a.status === '퇴사') - (b.status === '퇴사') || (a.hireDate || '').localeCompare(b.hireDate || ''));
    body = `<section class="card">
      <div class="card-head"><div class="toolbar">
        <input id="empQ" class="search" type="search" placeholder="이름·부서 검색" value="${esc(ui.empQ)}" data-filter="empQ">
        <label class="check"><input type="checkbox" data-filter="showRetired" ${ui.showRetired ? 'checked' : ''}> 퇴사자 포함</label></div>
        <button class="btn sm" data-act="csv" data-ent="employees">CSV 내보내기</button></div>
      ${table('employees', rows, {
        rowClass: (r) => (r.status === '퇴사' ? 'is-done' : ''),
        extra: {
          tenure: { l: '근속', f: (r) => esc(tenure(r)) },
          annual: { l: '연차 잔여/발생', num: 1, f: (r) => { const li = r.status !== '퇴사' && leaveInfo(r); return li ? `<b>${li.remain}</b> / ${li.granted}일` : '<span class="muted">-</span>'; } },
          checks: { l: '입·퇴사 처리', f: (r) => `${r.contract ? '' : badge('계약서', 'danger')} ${r.insured || r.empType === '프리랜서' ? '' : badge('4대보험', 'warn')}
            <button class="btn sm" data-act="${r.status === '퇴사' ? 'offboard' : 'onboard'}" data-id="${r.id}">${r.status === '퇴사' ? '퇴사' : '입사'} 체크리스트 생성</button>` },
        },
        empty: '등록된 직원이 없습니다. 오른쪽 위 "+ 직원"으로 추가하세요.',
      })}
      <div class="note">연차는 <b>입사일 기준</b>으로 계산합니다: 1년 미만은 1개월 개근 시 1일(최대 11일), 1년 이상은 15일 + 2년마다 1일 가산(최대 25일). 출근율 80% 미만, 회계연도 기준 운영, 상시 5인 미만 사업장(연차 규정 미적용) 등은 반영하지 않으니 필요 시 조정하세요.</div>
    </section>`;
  } else if (ui.hrTab === 'leaves') {
    const rows = state.leaves.filter((l) => !ui.leaveEmp || l.employeeId === ui.leaveEmp).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
    const summary = state.employees.filter((e) => e.status !== '퇴사').map((e) => ({ e, li: leaveInfo(e) })).filter((x) => x.li);
    body = `<div class="grid grid-2">
      <section class="card"><div class="card-head"><h2>직원별 연차 현황</h2></div>
        ${summary.length ? `<div class="table-wrap"><table><thead><tr><th>이름</th><th>산정기간</th><th class="num">발생</th><th class="num">사용</th><th class="num">잔여</th></tr></thead><tbody>
          ${summary.map(({ e, li }) => `<tr><td>${esc(e.name)}</td><td><small>${fmtDate(li.periodStart)} ~ ${fmtDate(li.periodEnd)}</small></td><td class="num">${li.granted}</td><td class="num">${li.used}</td><td class="num"><b>${li.remain}</b></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">재직 중인 직원이 없습니다.</div>'}
      </section>
      <section class="card"><div class="card-head"><h2>휴가 사용 기록</h2>
        <select data-filter="leaveEmp" aria-label="직원 선택"><option value="">전체 직원</option>${state.employees.map((e) => `<option value="${e.id}" ${ui.leaveEmp === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></div>
        ${table('leaves', rows, { cols: ['start', 'employeeId', 'type', 'days'], empty: '휴가 기록이 없습니다.' })}
      </section></div>`;
  } else {
    body = `<div class="grid grid-2">
      <section class="card"><h2>입사 시</h2><div class="note" style="margin-top:8px"><ul>
        <li>근로계약서 작성·교부 (임금·근로시간·휴일·연차 명시, 서면 교부 의무)</li>
        <li>4대보험 취득신고 — 입사일이 속한 달의 다음 달 15일까지</li>
        <li>개인정보 수집·이용 동의서, 비밀유지(보안)서약서</li>
        <li>근로소득 원천징수를 위한 부양가족 정보, 급여 계좌</li>
        <li>장비 지급(총무 &gt; 자산 등록), 업무 계정 발급</li>
        <li>수습 기간·평가 기준 안내 (수습 3개월 이내 최저임금 90% 감액은 1년 이상 계약 + 단순노무 외 직종만)</li>
        <li>정부지원 채용 지원금(예: 청년 채용 장려금) 요건 확인 — 입사 전후 신청 기한 주의</li>
      </ul></div></section>
      <section class="card"><h2>퇴사 시</h2><div class="note" style="margin-top:8px"><ul>
        <li>사직서 수리 및 퇴사일 확정, 업무 인수인계</li>
        <li>4대보험 상실신고 — 다음 달 15일까지 (고용보험 상실 사유 코드 정확히)</li>
        <li>퇴직금·미사용 연차수당 등 금품 청산 — 퇴직일로부터 14일 이내</li>
        <li>퇴직소득 원천징수 → 다음 달 10일 원천세 신고</li>
        <li>이직확인서 처리 (요청 시 10일 이내), 경력증명서 발급</li>
        <li>장비·계정 회수, 권한 해제</li>
      </ul></div></section></div>
      <div class="note">직원 명부의 <b>입사/퇴사 체크리스트 생성</b> 버튼을 누르면 위 항목이 마감일과 함께 할 일로 자동 등록됩니다.</div>`;
  }
  return `
    ${head('인사', '직원 명부, 근속·연차 자동 계산, 휴가 기록, 입·퇴사 처리', `${addBtn('employees', '직원')}<button class="btn" data-act="add" data-ent="leaves">+ 휴가 기록</button>`)}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${ui.hrTab === k ? 'active' : ''}" data-act="tab" data-g="hrTab" data-t="${k}">${l}</button>`).join('')}</div>
    ${body}`;
};

VIEWS.accounting = () => {
  const months = [...new Set([today().slice(0, 7), ...state.expenses.map((x) => x.date?.slice(0, 7)).filter(Boolean)])].sort().reverse();
  const rows = state.expenses
    .filter((x) => (!ui.expMonth || x.date?.startsWith(ui.expMonth)) && (!ui.expGrant || (ui.expGrant === '-' ? !x.grantId : x.grantId === ui.expGrant)) && matchQ(x, ui.expQ))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const total = rows.reduce((s, x) => s + num(x.amount), 0);
  const byAcc = {};
  for (const x of rows) byAcc[x.account || '기타'] = (byAcc[x.account || '기타'] || 0) + num(x.amount);
  const accRows = Object.entries(byAcc).sort((a, b) => b[1] - a[1]);
  const max = accRows[0]?.[1] || 1;
  const byMethod = {};
  for (const x of rows) byMethod[x.method || '-'] = (byMethod[x.method || '-'] || 0) + num(x.amount);
  const flagged = rows.filter((x) => expenseFlag(x)).length;
  return `
    ${head('회계·지출', '법인카드·계좌이체 지출과 증빙을 기록하고 계정과목별로 집계합니다.', addBtn('expenses', '지출'))}
    <div class="kpis">
      <div class="card kpi"><div class="label">${ui.expMonth ? `${ui.expMonth.replace('-', '년 ')}월` : '전체 기간'} 합계</div><div class="value">${manwon(total)}</div><div class="sub">${rows.length}건</div></div>
      ${Object.entries(byMethod).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `<div class="card kpi"><div class="label">${esc(k)}</div><div class="value">${manwon(v)}</div></div>`).join('')}
      <div class="card kpi"><div class="label">증빙·정산 확인 필요</div><div class="value">${flagged}건</div><div class="sub ${flagged ? 'danger' : ''}">${flagged ? '표에서 ⚠ 항목 확인' : '이상 없음'}</div></div>
    </div>
    <section class="card">
      <div class="card-head"><div class="toolbar">
        <select data-filter="expMonth" aria-label="월"><option value="">전체 기간</option>${months.map((mm) => `<option value="${mm}" ${ui.expMonth === mm ? 'selected' : ''}>${mm.replace('-', '년 ')}월</option>`).join('')}</select>
        <select data-filter="expGrant" aria-label="지원사업"><option value="">전체 재원</option><option value="-" ${ui.expGrant === '-' ? 'selected' : ''}>자체 비용</option>${state.grants.map((g) => `<option value="${g.id}" ${ui.expGrant === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
        <input id="expQ" class="search" type="search" placeholder="거래처·내용 검색" value="${esc(ui.expQ)}" data-filter="expQ"></div>
        <button class="btn sm" data-act="csv" data-ent="expenses">CSV 내보내기</button></div>
      ${table('expenses', rows, {
        rowClass: (r) => (expenseFlag(r) ? 'is-warn' : ''),
        extra: { flag: { l: '확인', f: (r) => { const f = expenseFlag(r); return f ? badge(`⚠ ${f}`, 'warn') : r.settled ? badge('정산완료', 'ok') : ''; } } },
        foot: (defs) => `<tr><td colspan="${defs.findIndex((d) => d.k === 'amount')}">합계</td><td class="num">${won(total)}</td><td colspan="${defs.length - defs.findIndex((d) => d.k === 'amount')}"></td></tr>`,
        empty: '해당 조건의 지출이 없습니다.',
      })}
    </section>
    <section class="card"><div class="card-head"><h2>계정과목별 집계</h2></div>
      ${accRows.length ? accRows.map(([k, v]) => `<div class="bar-row"><span>${esc(k)}</span><span class="bar"><span style="width:${(v / max) * 100}%"></span></span><span class="amt">${won(v)} <small>${total ? Math.round((v / total) * 100) : 0}%</small></span></div>`).join('') : '<div class="empty">집계할 지출이 없습니다.</div>'}
      <div class="note">세법상 건당 3만원 초과 거래는 세금계산서·계산서·신용카드전표·현금영수증 등 <b>적격증빙</b>이 필요합니다(미수취 시 증빙불비가산세 2%, 기업업무추진비는 손금불산입). 이 화면은 내부 관리용이며 장부·신고는 세무대리인과 확인하세요.</div>
    </section>`;
};

VIEWS.grants = () => {
  const order = ['협약·수행중', '정산중', '선정', '신청완료', '신청준비', '공고검토', '완료', '미선정'];
  const list = [...state.grants].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (a.applyDue || a.end || '').localeCompare(b.applyDue || b.end || ''));
  const t = today();
  const cards = list.map((g) => {
    const st = grantStats(g);
    const next = [['applyDue', '신청 마감'], ['interimDue', '중간보고'], ['finalDue', '최종보고'], ['end', '협약 종료'], ['settleDue', '정산 마감']]
      .filter(([k]) => g[k] && g[k] >= t).sort((a, b) => g[a[0]].localeCompare(g[b[0]]))[0];
    const pct = Math.min(st.rate * 100, 100);
    return `<article class="card grant-card">
      <div class="card-head"><h2>${esc(g.name)}</h2>${badge(g.status)}</div>
      <small>${esc(g.agency || '기관 미입력')} · ${esc(g.program || '')}${g.manager ? ` · 담당 ${esc(g.manager)}` : ''}</small>
      <dl class="meta">
        <dt>협약기간</dt><dd>${g.start ? `${fmtDate(g.start)} ~ ${fmtDate(g.end)}` : '<span class="muted">-</span>'}</dd>
        <dt>사업비</dt><dd>${num(g.govFund) || num(g.selfCash) ? `정부 ${manwon(g.govFund)} · 자부담 현금 ${manwon(g.selfCash)}${num(g.selfInKind) ? ` · 현물 ${manwon(g.selfInKind)}` : ''}` : '<span class="muted">-</span>'}</dd>
        <dt>다음 기한</dt><dd>${next ? `${next[1]} ${fmtDate(g[next[0]])} <span class="dday ${ddayTone(g[next[0]])}">${dday(g[next[0]])}</span>` : '<span class="muted">-</span>'}</dd>
      </dl>
      ${st.budget ? `<div class="progress ${st.rate > 1 ? 'over' : ''}"><span style="width:${pct}%"></span></div>
        <div class="progress-label"><span>집행 ${manwon(st.exec)}</span><span>${(st.rate * 100).toFixed(1)}% / 현금 사업비 ${manwon(st.budget)}</span></div>` : ''}
      ${g.memo ? `<p><small>${esc(g.memo)}</small></p>` : ''}
      <footer><button class="btn sm" data-act="edit" data-ent="grants" data-id="${g.id}">수정</button>
        <button class="btn sm" data-act="grant-exp" data-id="${g.id}">집행내역</button>
        <button class="btn sm" data-act="add" data-ent="expenses" data-preset='${esc(JSON.stringify({ grantId: g.id }))}'>+ 집행 등록</button>
        ${g.url ? `<a class="btn sm ghost" href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener">링크 ↗</a>` : ''}</footer>
    </article>`;
  }).join('');
  return `
    ${head('정부지원사업', '공고 검토부터 신청·협약·수행·정산까지 단계와 사업비 집행률을 관리합니다.', addBtn('grants', '지원사업'))}
    ${list.length ? `<div class="grant-cards">${cards}</div>` : '<div class="empty">등록된 지원사업이 없습니다. 검토 중인 공고부터 등록해 보세요.</div>'}
    <section class="card" style="margin-top:16px"><h2>정산 대비 체크리스트</h2><div class="note"><ul>
      <li>사업비는 <b>전용 계좌·전용 카드</b>로 집행하고, 협약 기간 내 발생·지급분만 인정되는지 확인</li>
      <li>건별 증빙: 세금계산서/카드전표 + 이체확인증 + 견적서·계약서 + 검수조서(납품 확인) + 결과물 사진</li>
      <li>인건비: 참여율·근로계약서·급여명세서·4대보험 납부 확인서, 기존 인력 인건비 인정 여부 확인</li>
      <li>비목 간 전용(변경) 한도와 사전 승인 필요 여부, 부가세 환급분은 사업비 불인정이 일반적</li>
      <li>중간·최종 보고서 및 정산 시스템(예: 사업별 전용 시스템) 등록 기한을 위 카드에 입력해 두면 대시보드에 표시됩니다</li>
    </ul></div></section>`;
};

VIEWS.admin = () => {
  const tabs = [['contracts', '계약·구독'], ['assets', '자산·비품']];
  let body;
  if (ui.adminTab === 'contracts') {
    const rows = [...state.contracts].sort((a, b) => contractActive(b) - contractActive(a) || (a.end || '9999').localeCompare(b.end || '9999'));
    const monthly = state.contracts.filter(contractActive).reduce((s, c) => s + monthlyCost(c), 0);
    body = `<div class="kpis">
      <div class="card kpi"><div class="label">유효 계약</div><div class="value">${state.contracts.filter(contractActive).length}건</div></div>
      <div class="card kpi"><div class="label">월 고정비 (환산)</div><div class="value">${manwon(monthly)}</div><div class="sub">연 ${manwon(monthly * 12)}</div></div>
      <div class="card kpi"><div class="label">60일 내 만료</div><div class="value">${state.contracts.filter((c) => c.end && c.end >= today() && diffDays(today(), c.end) <= 60).length}건</div></div>
    </div>
    <section class="card"><div class="card-head"><h2>계약·구독 목록</h2><button class="btn sm" data-act="csv" data-ent="contracts">CSV 내보내기</button></div>
      ${table('contracts', rows, {
        rowClass: (r) => (!contractActive(r) ? 'is-done' : r.end && diffDays(today(), r.end) <= 60 ? 'is-warn' : ''),
        extra: {
          remain: { l: '남은 기간', f: (r) => (r.end ? (contractActive(r) ? `<span class="dday ${diffDays(today(), r.end) <= 30 ? 'warn' : ''}">${dday(r.end)}</span>` : badge('만료')) : '<span class="muted">-</span>') },
          monthly: { l: '월 환산', num: 1, f: (r) => (monthlyCost(r) ? won(monthlyCost(r)) : '<span class="muted">-</span>') },
        },
        empty: '사무실 임대차, SaaS 구독, 보험 등 계약을 등록하면 만료·통보 기한을 알려 줍니다.',
      })}</section>`;
  } else {
    const rows = [...state.assets].sort((a, b) => (a.status === '폐기') - (b.status === '폐기') || (a.kind || '').localeCompare(b.kind || ''));
    const live = state.assets.filter((a) => a.status !== '폐기');
    body = `<div class="kpis">
      <div class="card kpi"><div class="label">보유 자산</div><div class="value">${live.length}건</div></div>
      <div class="card kpi"><div class="label">취득가 합계</div><div class="value">${manwon(live.reduce((s, a) => s + num(a.price), 0))}</div></div>
      <div class="card kpi"><div class="label">미배정(보관)</div><div class="value">${live.filter((a) => a.status === '보관').length}건</div></div>
    </div>
    <section class="card"><div class="card-head"><h2>자산·비품 대장</h2><button class="btn sm" data-act="csv" data-ent="assets">CSV 내보내기</button></div>
      ${table('assets', rows, { rowClass: (r) => (r.status === '폐기' ? 'is-done' : ''), empty: '노트북·모니터·SW 라이선스 등을 등록해 사용자별로 관리하세요.' })}
      <div class="note">퇴사자 장비 회수 시 사용자를 비우고 상태를 "보관"으로 바꾸세요. 100만원 이상 비품은 회계상 유형자산(비품) 처리 여부를 세무대리인과 확인하세요.</div></section>`;
  }
  return `
    ${head('총무', '계약·구독 만료 관리, 월 고정비, 자산·비품 대장', ui.adminTab === 'contracts' ? addBtn('contracts', '계약') : addBtn('assets', '자산'))}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${ui.adminTab === k ? 'active' : ''}" data-act="tab" data-g="adminTab" data-t="${k}">${l}</button>`).join('')}</div>
    ${body}`;
};

VIEWS.settings = () => {
  const s = state.settings;
  const counts = ['todos', 'employees', 'leaves', 'expenses', 'grants', 'contracts', 'assets'].map((k) => `${SCHEMA[k].name} ${state[k].length}`).join(' · ');
  return `
    ${head('설정·백업', '회사 정보, 공휴일, 반복 일정, 데이터 백업')}
    <div class="grid grid-2">
      <section class="card"><div class="card-head"><h2>기본 설정</h2></div>
        <form id="settingsForm" class="settings-form">
          <div class="field"><label for="s-company">회사명</label><input id="s-company" name="company" value="${esc(s.company)}"></div>
          <div class="field"><label for="s-payday">급여일 (매월)</label><input id="s-payday" name="payday" type="number" min="1" max="31" value="${esc(s.payday)}"></div>
          <div class="field"><label for="s-look">대시보드 일정 표시 기간(일)</label><input id="s-look" name="lookahead" type="number" min="7" max="180" value="${esc(s.lookahead)}"></div>
          <div class="field"><label for="s-theme">화면 테마</label><select id="s-theme" name="theme">${[['auto', '시스템 설정'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field wide"><label for="s-hol">공휴일 목록</label><textarea id="s-hol" name="holidays" rows="9">${esc(s.holidays)}</textarea><small class="hint">신고·납부 기한이 공휴일이면 다음 영업일로 계산합니다. 매년 공휴일·대체공휴일 확정 후 추가하세요.</small></div>
          <div class="field wide"><button class="btn primary" type="submit">설정 저장</button></div>
        </form></section>
      <section class="card"><div class="card-head"><h2>데이터 백업</h2></div>
        <p class="muted">모든 데이터는 <b>이 브라우저(localStorage)</b>에만 저장됩니다. 브라우저 데이터 삭제·PC 교체 시 사라지므로 정기적으로 백업 파일을 회사 드라이브에 보관하세요.</p>
        <p><small>현재 데이터: ${counts}<br>마지막 백업: ${s.lastBackup ? fmtDate(s.lastBackup) : '없음'}</small></p>
        <div class="toolbar"><button class="btn primary" data-act="export">백업 파일 내보내기 (JSON)</button><button class="btn" data-act="import">백업 불러오기</button></div>
        <br><div class="toolbar"><button class="btn danger" data-act="reset">전체 초기화</button></div>
        <div class="note">개인정보보호법상 직원 정보는 업무에 필요한 최소한만 입력하고, 백업 파일은 접근 권한이 제한된 곳에 보관하세요.</div>
      </section>
    </div>
    <section class="card"><div class="card-head"><h2>사용자 반복 일정</h2>${addBtn('customRules', '반복 일정')}</div>
      <p class="muted">기본 제공 법정 일정 외에 회사 고유의 정기 업무(예: 매월 5일 법인카드 정산, 분기 이사회)를 추가합니다.</p>
      ${table('customRules', state.customRules, { empty: '추가한 반복 일정이 없습니다.' })}</section>
    <section class="card"><div class="card-head"><h2>기본 제공 법정·정기 일정</h2></div>
      <div class="table-wrap"><table><thead><tr><th>분류</th><th>일정</th><th>시기</th></tr></thead><tbody>
      ${RULES.map((r) => `<tr><td><span class="chip ${catClass(r.cat)}">${r.cat}</span></td><td>${esc(r.title)}${r.note ? `<br><small>${esc(r.note)}</small>` : ''}</td><td>${r.months === 'all' ? '매월' : `${r.months.join('·')}월`} ${r.day === 'last' ? '말일' : r.day === 'payday' ? '급여일' : `${r.day}일`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="note">세법·4대보험 제도는 매년 바뀔 수 있습니다. 실제 신고 전 홈택스·4대사회보험 정보연계센터 공지와 세무대리인 안내를 확인하세요.</div></section>`;
};

/* =========================================================
 * 폼 (추가·수정)
 * ========================================================= */
function fieldInput(f, v) {
  const id = `f-${f.k}`;
  const val = v ?? (typeof f.d === 'function' ? f.d() : f.d) ?? '';
  const req = f.req ? 'required' : '';
  switch (f.t) {
    case 'textarea': return `<textarea id="${id}" name="${f.k}" rows="3">${esc(val)}</textarea>`;
    case 'select': return `<select id="${id}" name="${f.k}" ${req}><option value="">${f.req ? '선택' : '-'}</option>${opts(f).map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    case 'check': return `<label class="check"><input type="checkbox" id="${id}" name="${f.k}" ${val ? 'checked' : ''}> ${esc(f.cl || '예')}</label>`;
    case 'money': return `<input id="${id}" name="${f.k}" type="text" inputmode="numeric" data-money value="${val === '' ? '' : num(val).toLocaleString('ko-KR')}" ${req} placeholder="0">`;
    case 'number': return `<input id="${id}" name="${f.k}" type="number" step="any" value="${esc(val)}" ${req}>`;
    case 'date': return `<input id="${id}" name="${f.k}" type="date" value="${esc(val)}" ${req}>`;
    case 'url': return `<input id="${id}" name="${f.k}" type="url" value="${esc(val)}" placeholder="https://">`;
    default: return `<input id="${id}" name="${f.k}" type="text" value="${esc(val)}" ${req}>`;
  }
}

function openForm(ent, id, preset = {}) {
  const S = SCHEMA[ent];
  const rec = id ? state[ent].find((r) => r.id === id) : { ...preset };
  if (!rec) return;
  if (ent === 'leaves' && !state.employees.length) { toast('먼저 직원을 등록하세요.'); return; }
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="form" id="entForm" novalidate>
    <header class="modal-head"><h2>${esc(S.name)} ${id ? '수정' : '추가'}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">✕</button></header>
    <div class="form-grid">${S.fields.map((f) => `<div class="field ${f.wide ? 'wide' : ''}">
      ${f.t === 'check' ? `<span class="label" style="font-size:12px;font-weight:600;color:var(--muted)">${esc(f.l)}</span>` : `<label for="f-${f.k}">${esc(f.l)}${f.req ? ' <span class="req">*</span>' : ''}</label>`}
      ${fieldInput(f, rec[f.k])}${f.h ? `<small class="hint">${esc(f.h)}</small>` : ''}</div>`).join('')}</div>
    <footer class="modal-foot">${id ? '<button type="button" class="btn danger" data-del>삭제</button>' : ''}<span class="spacer"></span>
      <button type="button" class="btn" data-close>취소</button><button type="submit" class="btn primary">저장</button></footer></form>`;
  const form = $('#entForm', dlg);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {};
    for (const f of S.fields) {
      const el = form.elements.namedItem(f.k);
      if (!el) continue;
      let v = f.t === 'check' ? el.checked : el.value.trim();
      if ((f.t === 'money' || f.t === 'number') && v !== '') v = num(v);
      if (f.req && (v === '' || v == null)) { toast(`${f.l}을(를) 입력하세요.`); el.focus(); return; }
      data[f.k] = v;
    }
    const err = S.validate?.(data);
    if (err) { toast(err); return; }
    S.beforeSave?.(data);
    if (id) Object.assign(rec, data, { updated: today() });
    else state[ent].push({ id: uid(), ...data, created: today() });
    save(); dlg.close(); render(); toast('저장했습니다.');
  });
  form.addEventListener('input', (e) => {
    if (e.target.matches('[data-money]')) {
      const raw = e.target.value.replace(/[^\d]/g, '');
      e.target.value = raw ? Number(raw).toLocaleString('ko-KR') : '';
    }
  });
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => dlg.close(); });
  const del = $('[data-del]', dlg);
  if (del) del.onclick = () => { if (removeRecord(ent, id)) dlg.close(); };
  dlg.showModal();
  form.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
}

function removeRecord(ent, id) {
  if (!confirm('삭제할까요? 되돌릴 수 없습니다.')) return false;
  state[ent] = state[ent].filter((r) => r.id !== id);
  if (ent === 'grants') state.expenses.forEach((x) => { if (x.grantId === id) x.grantId = ''; });
  if (ent === 'employees') {
    state.leaves = state.leaves.filter((l) => l.employeeId !== id);
    state.assets.forEach((a) => { if (a.assignee === id) { a.assignee = ''; a.status = '보관'; } });
  }
  save(); render(); toast('삭제했습니다.');
  return true;
}

/* ---------- 입·퇴사 체크리스트 ---------- */
function makeChecklist(id, type) {
  const e = state.employees.find((x) => x.id === id);
  if (!e) return;
  const base = type === 'on' ? e.hireDate : e.leaveDate;
  if (!base) { toast(type === 'on' ? '입사일을 먼저 입력하세요.' : '퇴사일을 먼저 입력하세요.'); return; }
  const items = type === 'on'
    ? [[-3, '근로계약서 작성·교부 (서명본 보관)'], [0, '개인정보 수집·이용 동의서, 비밀유지서약서 징구'], [0, '급여 계좌·부양가족(원천징수) 정보 수집'],
      [-1, '업무 장비 지급 및 자산대장 등록'], [-1, '업무 계정 발급 (메일·협업툴·저장소)'], ['ins', '4대보험 취득신고'], [7, '수습 기간·평가 기준 안내'],
      [14, '채용 관련 정부지원금(고용지원) 신청 요건 확인']]
    : [[-14, '사직서 수리 및 퇴사일 확정, 인수인계 계획'], [0, '업무 인수인계 완료 확인'], [0, '장비 회수 (자산대장 반영)'], [0, '계정 회수·권한 해제'],
      [14, '퇴직금·미사용 연차수당 등 금품 청산 (퇴직 후 14일 이내)'], ['ins', '4대보험 상실신고'], ['wht', '퇴직소득 원천징수 → 원천세 신고'],
      [10, '이직확인서 처리(요청 시 10일 이내), 경력증명서 발급']];
  const label = type === 'on' ? '입사' : '퇴사';
  let added = 0;
  for (const [off, title] of items) {
    const due = off === 'ins' ? nextMonthDay(base, 15) : off === 'wht' ? nextMonthDay(base, 10) : addDays(base, off);
    const full = `[${e.name} ${label}] ${title}`;
    if (state.todos.some((t) => t.title === full)) continue;
    state.todos.push({ id: uid(), title: full, category: '인사', due, priority: off === 'ins' || off === 14 ? '높음' : '보통', status: '대기', created: today() });
    added++;
  }
  save(); render();
  toast(added ? `${label} 체크리스트 ${added}건을 할 일에 추가했습니다.` : '이미 생성된 체크리스트입니다.');
}

/* ---------- CSV · 백업 ---------- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv(ent) {
  const S = SCHEMA[ent];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [S.fields.map((f) => q(f.l)).join(',')];
  for (const r of state[ent]) {
    lines.push(S.fields.map((f) => {
      const v = r[f.k];
      if (f.t === 'check') return q(v ? 'Y' : '');
      if (f.t === 'select' && v) return q(optLabel(f, v));
      return q(v);
    }).join(','));
  }
  download(`${S.name}_${today()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8');
}
function exportJson() {
  state.settings.lastBackup = today();
  save();
  download(`경영지원보드_백업_${today().replace(/-/g, '')}.json`, JSON.stringify(state, null, 2), 'application/json');
  render();
}
function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object' || !data.settings) throw new Error('형식 오류');
      if (!confirm('현재 데이터를 백업 파일 내용으로 바꿉니다. 계속할까요?')) return;
      state = normalize(data); save(); applyTheme(); render(); toast('백업을 불러왔습니다.');
    } catch (e) { toast('불러오기 실패: 이 도구에서 내보낸 JSON 파일인지 확인하세요.'); }
  };
  reader.readAsText(file);
}

/* ---------- 샘플 데이터 ---------- */
function loadSample() {
  const t = today();
  const e1 = uid(); const e2 = uid(); const g1 = uid();
  state.employees.push(
    { id: e1, name: '샘플 개발자', dept: '개발팀', position: '선임', empType: '정규직', status: '재직', hireDate: addDays(t, -500), insured: true, contract: true },
    { id: e2, name: '샘플 신입', dept: '개발팀', position: '사원', empType: '정규직', status: '재직', hireDate: addDays(t, -40), probationEnd: addDays(t, 50), insured: false, contract: true },
  );
  state.leaves.push({ id: uid(), employeeId: e1, type: '연차', start: addDays(t, 9), end: addDays(t, 10), days: 2 });
  state.grants.push({ id: g1, name: '(샘플) 초기창업패키지', agency: '창업진흥원', program: '사업화·창업', status: '협약·수행중', start: addDays(t, -150), end: addDays(t, 40), govFund: 70000000, selfCash: 9000000, finalDue: addDays(t, 55), settleDue: addDays(t, 70) });
  state.grants.push({ id: uid(), name: '(샘플) 데이터바우처 지원사업', agency: '한국데이터산업진흥원', program: '바우처', status: '신청준비', applyDue: addDays(t, 12) });
  state.expenses.push(
    { id: uid(), date: t, account: '지급수수료', vendor: '클라우드 서비스', desc: '서버 이용료', amount: 385000, method: '법인카드', evidence: '카드전표', grantId: g1, settled: true },
    { id: uid(), date: t, account: '복리후생비', vendor: '인근 식당', desc: '팀 점심', amount: 64000, method: '개인카드(정산)', evidence: '간이영수증', settled: false },
    { id: uid(), date: addDays(t, -3), account: '소모품비', vendor: '온라인몰', desc: '사무용품', amount: 27500, method: '법인카드', evidence: '카드전표', settled: true },
  );
  state.contracts.push(
    { id: uid(), name: '(샘플) 사무실 임대차', counterparty: '임대인', kind: '사무실 임대차', start: addDays(t, -320), end: addDays(t, 45), amount: 1500000, cycle: '월', noticeDays: 30 },
    { id: uid(), name: '(샘플) 협업툴 구독', counterparty: 'SaaS 업체', kind: 'SaaS·구독', end: addDays(t, 200), amount: 1200000, cycle: '연', autoRenew: true },
  );
  state.assets.push({ id: uid(), name: '노트북', kind: '노트북·PC', serial: 'NB-001', assignee: e1, purchaseDate: addDays(t, -480), price: 2300000, status: '사용중' });
  state.todos.push(
    { id: uid(), title: '(샘플) 신입 4대보험 취득신고', category: '4대보험', due: addDays(t, 5), priority: '높음', status: '대기' },
    { id: uid(), title: '(샘플) 지원사업 증빙 서류 정리', category: '정부지원', due: addDays(t, -1), priority: '보통', status: '진행' },
  );
  save(); render(); toast('샘플 데이터를 추가했습니다. 설정에서 초기화할 수 있습니다.');
}

/* =========================================================
 * 렌더링 · 이벤트
 * ========================================================= */
function currentView() { const v = location.hash.slice(1); return VIEWS[v] ? v : 'dashboard'; }
function applyTheme() {
  const th = state.settings.theme;
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th;
  else delete document.documentElement.dataset.theme;
}
function render() {
  const v = currentView();
  $('#view').innerHTML = VIEWS[v]();
  $('#companyName').textContent = state.settings.company || '';
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.matches('input[type=checkbox]')) return;
  const { act, ent, id } = b.dataset;
  switch (act) {
    case 'add': openForm(ent, null, b.dataset.preset ? JSON.parse(b.dataset.preset) : {}); break;
    case 'edit': openForm(ent, id); break;
    case 'tab': ui[b.dataset.g] = b.dataset.t; render(); break;
    case 'cal': {
      const d = num(b.dataset.d);
      if (d === 0) ui.calMonth = today().slice(0, 7);
      else { const [y, m] = ui.calMonth.split('-').map(Number); const nd = new Date(y, m - 1 + d, 1); ui.calMonth = `${nd.getFullYear()}-${pad(nd.getMonth() + 1)}`; }
      render(); break;
    }
    case 'onboard': makeChecklist(id, 'on'); break;
    case 'offboard': makeChecklist(id, 'off'); break;
    case 'grant-exp': ui.expGrant = id; ui.expMonth = ''; location.hash = '#accounting'; break;
    case 'csv': exportCsv(ent); break;
    case 'export': exportJson(); break;
    case 'import': $('#importFile').click(); break;
    case 'sample': loadSample(); break;
    case 'reset':
      if (confirm('모든 데이터를 삭제합니다. 먼저 백업하셨나요?') && confirm('정말 초기화할까요? 되돌릴 수 없습니다.')) {
        state = structuredClone(DEFAULTS); state.settings.since = today(); save(); applyTheme(); render(); toast('초기화했습니다.');
      }
      break;
    default: break;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'importFile') { if (el.files[0]) importJson(el.files[0]); el.value = ''; return; }
  if (el.dataset.act === 'rule-done') {
    if (el.checked) state.done[el.dataset.key] = today(); else delete state.done[el.dataset.key];
    save(); render(); return;
  }
  if (el.dataset.act === 'todo-done') {
    const t = state.todos.find((x) => x.id === el.dataset.id);
    if (t) { t.status = el.checked ? '완료' : '대기'; t.doneAt = el.checked ? today() : ''; save(); render(); }
    return;
  }
  if (el.dataset.filter && el.type !== 'search') {
    ui[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    render();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.type !== 'search' || !el.dataset.filter) return;
  ui[el.dataset.filter] = el.value;
  const pos = el.selectionStart;
  render();
  const again = document.getElementById(el.id);
  if (again) { again.focus(); again.setSelectionRange(pos, pos); }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'settingsForm') return;
  e.preventDefault();
  const f = e.target.elements;
  Object.assign(state.settings, {
    company: f.company.value.trim(),
    payday: Math.min(Math.max(num(f.payday.value) || 25, 1), 31),
    lookahead: Math.min(Math.max(num(f.lookahead.value) || 45, 7), 180),
    theme: f.theme.value,
    holidays: f.holidays.value,
  });
  save(); applyTheme(); render(); toast('설정을 저장했습니다.');
});

window.addEventListener('hashchange', () => { render(); $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); });
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { state = load(); render(); } });

applyTheme();
render();
