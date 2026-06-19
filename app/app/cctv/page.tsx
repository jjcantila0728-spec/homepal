import { redirect } from 'next/navigation';

// The CCTV view was folded into Smart Home; keep old links working.
export default function CctvPage() {
  redirect('/app/home');
}
