import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VeloRoute AI',
  description: "Génère des boucles vélo sur mesure à partir d'une durée et d'un D+ max.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
