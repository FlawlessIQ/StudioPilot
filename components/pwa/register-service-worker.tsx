"use client";
import { useEffect } from "react";
// Not on the public inquiry form: a couple filling it in (or a studio's website
// embedding it) has no use for an offline app shell (H5).
const PUBLIC_FORM = /^\/inquiry(\/|$)/;
export function RegisterServiceWorker(){useEffect(()=>{if(PUBLIC_FORM.test(window.location.pathname))return;if("serviceWorker" in navigator&&process.env.NODE_ENV==="production"){void navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(()=>undefined)}},[]);return null}
