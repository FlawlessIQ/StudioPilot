import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const BASE=process.argv[2], ROUTE=process.argv[3], SEL=process.argv[4], WHO=process.argv[5]??"owner";
const env=Object.fromEntries(readFileSync(".env.local","utf8").split("\n").map(l=>l.split("=")).filter(p=>p.length>=2).map(([k,...v])=>[k.trim(),v.join("=").trim()]));
const b=await chromium.launch(); const page=await b.newPage({viewport:{width:1440,height:1200}});
await page.goto(`${BASE}/auth/login`,{waitUntil:"domcontentloaded"});
await page.locator("input[type=email]").first().fill(WHO==="crew"?"crew@studiohub.test":"owner@studiohub.test");
await page.locator("input[type=password]").first().fill(env.SEED_DEMO_PASSWORD);
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(9000);
await page.goto(BASE+ROUTE,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate((sel)=>{
  const el=document.querySelector(sel); if(!el) return {error:"not found"};
  const hits=[]; let unreadable=0;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules } catch { unreadable++; continue }
    const walk=(list)=>{ for(const r of list){
      if (r.cssRules) { walk(r.cssRules); continue }
      if (!r.selectorText || !r.style) continue;
      if (!/padding|--panel-inset/.test(r.style.cssText)) continue;
      try { if (!el.matches(r.selectorText) && !/:root|html/.test(r.selectorText)) continue } catch { continue }
      hits.push({ sel: r.selectorText.slice(0,90), css: r.style.cssText.slice(0,110), href: (sheet.href||"inline").split("/").pop() });
    }};
    walk(rules);
  }
  return { sheets: document.styleSheets.length, unreadable,
    hrefs: [...document.styleSheets].map(s=>(s.href||"inline").split("/").pop()),
    computedPadding: getComputedStyle(el).padding, hits };
}, SEL), null, 1));
await b.close();
