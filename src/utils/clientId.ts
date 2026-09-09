// Client / Device identification for tracking check-ins per terminal
const CLIENT_ID_KEY = 'club_attendance_client_id';

export function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'server';
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `term_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getFriendlyClientId(id: string): string {
  if (!id) return 'Unknown Device';
  if (id.startsWith('term_')) {
    return `Terminal-${id.substring(5, 9).toUpperCase()}`;
  }
  return id.substring(0, 12);
}
