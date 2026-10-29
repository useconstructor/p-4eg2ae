import type { Metadata } from 'next';
import localFont from 'next/font/local';
import branding from '@/branding.json';
import './globals.css';
const plex=localFont({src:[{path:'../public/fonts/plex-400.ttf',weight:'400'},{path:'../public/fonts/plex-500.ttf',weight:'500'},{path:'../public/fonts/plex-600.ttf',weight:'600'},{path:'../public/fonts/plex-700.ttf',weight:'700'}],variable:'--plex-local',display:'swap'});
export const metadata:Metadata={title:branding.logoText,description:'Una lista clara para tus tareas personales. Crea, edita y organiza tus pendientes.'};
export default function RootLayout({children}:{children:React.ReactNode}){
 const originals=['6dbe082463cf749cfa057d45c3048c90f4df031496498e5b5bdfd0b6babb9d16','6f7a8c4219e021ff7c9131bc5f1f7af97bcd1436a59578d444a8cb92e9791742','5311c66fd6d04ae45671236f7eae667b671c06c1dc7e88d52c206e5fadd0fb21','e129a20e8ff7c907ffd07124b573e88c323b7b18afc934d4aa539a3e0f2fe100'];
 const css=branding.brandbook.fontFaces.map(f=>`@font-face{font-family:${JSON.stringify(f.family)};font-weight:${f.weight};font-style:normal;font-display:swap;src:url("${originals.includes(f.sha256)?`/fonts/plex-${f.weight}.ttf`:f.url}") format("truetype")}`).join('');
 return <html lang="es"><head><style>{css}</style></head><body className={plex.variable} style={{'--brand-background':branding.backgroundColor,'--brand-surface':branding.secondaryColor,'--brand-primary':branding.primaryColor,'--brand-accent':branding.accentColor,'--brand-text':branding.textColor,'--brand-font-heading':`"${branding.fontHeading}",var(--plex-local),sans-serif`,'--brand-font-body':`"${branding.fontBody}",var(--plex-local),sans-serif`} as React.CSSProperties}>{children}{process.env.NEXT_PUBLIC_CONSTRUCTOR_API&&process.env.NEXT_PUBLIC_PROJECT_ID&&<script src={"https://constructor-api-prod.vercel.app/v1/projects/P-4EG2AE/analytics/script.js"} defer></script>}<script src="/constructor-editor.js" defer></script></body></html>
}
