import landing from './landing-content';
export function GET() {
  return new Response(landing, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
