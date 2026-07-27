"use client";
import { useEffect } from "react";
export function RegisterServiceWorker(){useEffect(()=>{if("serviceWorker" in navigator&&process.env.NODE_ENV==="production"){void navigator.serviceWorker.register("/sw.js",{scope:"/"}).catch(()=>undefined)}},[]);return null}
