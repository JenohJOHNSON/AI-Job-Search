import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Élan — Your next move', template: '%s · Élan' }, description: 'A private, intelligent workspace for your next career opportunity in France.' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('elan-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}" }} /></head><body>{children}</body></html>;
}
