import Link from "next/link";
import { CloudOff,RefreshCw } from "lucide-react";
import { Logo } from "@/components/brand/logo";
export default function OfflinePage(){return <main className="offline-page"><Logo/><CloudOff/><p className="eyebrow">Offline</p><h1>Your connection dropped.</h1><p>Previously opened event-day schedules remain available. Reconnect before changing acknowledgements, documents, or project records.</p><Link className="button button-dark" href="/crew/schedule"><RefreshCw size={16}/> Open cached schedule</Link></main>}
