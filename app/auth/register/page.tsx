import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft,CircleCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { RegisterForm } from "@/features/auth/register-form";
export const metadata:Metadata={title:"Start your trial · StudioHub",description:"Create a verified StudioHub account."};
export default function RegisterPage(){return <main className="auth-page"><section className="auth-brand-panel"><Link href="/" className="auth-back"><ArrowLeft size={16}/> Back to StudioHub</Link><div className="auth-quote"><Logo/><blockquote>Start with a calm operating system for every project—not another disconnected tool.</blockquote></div><div className="auth-trust"><span><CircleCheck size={15}/> 14-day Solo trial</span><span><CircleCheck size={15}/> No card required</span><span><CircleCheck size={15}/> Verified email required</span></div></section><section className="auth-form-panel"><div className="auth-form-wrap"><span className="eyebrow">Start your trial</span><h1>Create your account</h1><p>Verify your work email, then create your tenant-isolated studio.</p><RegisterForm/></div><p className="auth-legal">By continuing, you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p></section></main>}
