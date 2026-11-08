export type CellPhase = 'closed' | 'reserved' | 'open';
export type Cell = { id: number; phase: CellPhase; owner?: string; redeemed: boolean };
export type User = { name: string; email: string; hash: string; chances: number; cells: Record<string, number> };
export type Pack = { n: number; price: number };
export type PixOrder = { pack: Pack; end: number; payload: string; status: 'pending' | 'paid' | 'expired'; k: number | null };
export type KeyType = 'cpf' | 'phone' | 'email' | 'evp';
export const PACKS: Pack[] = [{ n: 1, price: 5 }, { n: 5, price: 20 }, { n: 10, price: 35 }, { n: 25, price: 75 }];
export const RESERVE_MS = 120000;
export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const plural = (n: number) => `${n} ${n === 1 ? 'chance' : 'chances'}`;
export const prizeValue = (id: number) => 5.9 + ((id * 37) % 95);
export const prizeKind = (id: number) => ['image', 'stat', 'icon', 'stat', 'image', 'stat', 'image'][id % 7];
export const iconPaths = [
  'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
  'M12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2Z',
  'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  'M3 8h18v4H3zM12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5',
];
export function art(id: number) {
  const n = (b: number, s: number, m: number) => b + ((id * s) % m);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(0,0%,${n(6, 7, 12)}%)"/><circle cx="${n(25, 13, 50)}" cy="${n(25, 29, 50)}" r="${n(14, 11, 22)}" fill="hsl(0,0%,${n(35, 9, 45)}%)"/><rect x="${n(8, 17, 40)}" y="${n(8, 23, 40)}" width="${n(20, 7, 30)}" height="${n(20, 5, 30)}" fill="none" stroke="hsl(0,0%,${n(60, 3, 30)}%)" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
export const digits = (s: string) => s.replace(/\D/g, '');
export function maskCpf(s: string) {
  return digits(s).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}
export function maskPhone(s: string) {
  let d = digits(s);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length > 6) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length > 2) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return d ? `(${d}` : '';
}
export function validCpf(value: string) {
  const c = digits(value);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(c[i]) * (t + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
export function parseKey(type: KeyType, value: string): { val?: string; err?: string } {
  let v = value.trim();
  if (type === 'cpf') return validCpf(v) ? { val: digits(v) } : { err: 'O CPF da chave Pix é inválido.' };
  if (type === 'phone') {
    let d = digits(v);
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return /^[1-9][1-9]9\d{8}$/.test(d) ? { val: `+55${d}` } : { err: 'Celular inválido. Use DDD e número com 9 dígitos.' };
  }
  v = v.toLowerCase();
  if (type === 'email') return v.length <= 77 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? { val: v } : { err: 'O e-mail da chave Pix é inválido.' };
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? { val: v } : { err: 'Chave aleatória inválida. Ela tem 32 caracteres, separados por hífens.' };
}
export function maskKey(type: KeyType, value: string) {
  if (type === 'cpf') return `***.${value.slice(3, 6)}.${value.slice(6, 9)}-**`;
  if (type === 'phone') return `(${value.slice(3, 5)}) *****-${value.slice(-4)}`;
  if (type === 'email') { const a = value.split('@'); return `${a[0].slice(0, 2)}***@${a[1]}`; }
  return `${value.slice(0, 8)}-****`;
}
export async function passwordHash(email: string, password: string) {
  const s = `v1:${email}:${password}`;
  if (!window.crypto?.subtle) return `p:${s}`;
  const bytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
const tlv = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value;
function crc16(s: string) {
  let c = 0xffff;
  for (let i = 0; i < s.length; i++) {
    c ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
  }
  return c.toString(16).toUpperCase().padStart(4, '0');
}
export function pixPayload(p: Pack) {
  const txid = (`PKT${p.n}${Date.now().toString(36)}`).toUpperCase().slice(0, 25);
  const s = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', 'teste@exemplo.com')) +
    tlv('52', '0000') + tlv('53', '986') + tlv('54', p.price.toFixed(2)) + tlv('58', 'BR') +
    tlv('59', 'LANCE TESTE') + tlv('60', 'SAO PAULO') + tlv('62', tlv('05', txid)) + '6304';
  return s + crc16(s);
}
export function formatTime(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `0${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
