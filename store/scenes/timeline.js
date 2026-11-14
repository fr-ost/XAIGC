// Sample posts for the stage. All accounts and content are made up.
(() => {
  const posts = [
    { name: "Nova Protocol", handle: "novaprotocol", time: "2h", color: "#4f46e5", text: "We just cut bridge fees by 80% for every user, starting Monday. Withdrawals included." , counts: [38, 112, 906, "41K"] },
    { name: "Maya Chen", handle: "mayabuilds", time: "4h", color: "#0f766e", text: "Shipped our eval harness today. 400 test cases, runs in under 3 minutes on a laptop.", counts: [12, 24, 318, "9.2K"] },
    { name: "Daily Markets", handle: "dailymarkets", time: "6h", color: "#b45309", text: "Season 2 leaderboard is live. Top 100 share 50,000 USDC in rewards.", quoted: { who: "Daily Markets · Mar 3", text: "Season 1 payouts are complete. Thanks for your patience." }, counts: [57, 80, 644, "28K"] },
  ];
  const icon = {
    reply: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.5L3 21l1.9-5.3A8.5 8.5 0 1 1 21 11.5z"/></svg>',
    repost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.4 5.4 0 0 0-7.7 0L12 6.7l-1.1-1.1a5.4 5.4 0 0 0-7.7 7.7L12 22l8.8-8.7a5.4 5.4 0 0 0 0-7.7z"/></svg>',
    views: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
  };
  const tl = document.getElementById("timeline");
  for (const p of posts) {
    const a = document.createElement("article");
    a.setAttribute("data-testid", "tweet");
    a.setAttribute("role", "article");
    a.innerHTML = `
      <div class="avatar" style="background:${p.color}">${p.name[0]}</div>
      <div class="body">
        <div data-testid="User-Name"><b>${p.name}</b><span>@${p.handle}</span><span>· ${p.time}</span></div>
        <div data-testid="tweetText"></div>
        ${p.quoted ? `<div class="quoted"><small>${p.quoted.who}</small><div data-testid="tweetText" class="q"></div></div>` : ""}
        <div role="group">
          <button class="act" data-testid="reply" aria-label="Reply">${icon.reply}${p.counts[0]}</button>
          <button class="act" aria-label="Repost">${icon.repost}${p.counts[1]}</button>
          <button class="act" aria-label="Like">${icon.like}${p.counts[2]}</button>
          <span class="act">${icon.views}${p.counts[3]}</span>
        </div>
      </div>`;
    a.querySelector('[data-testid="tweetText"]').textContent = p.text;
    if (p.quoted) a.querySelector(".q").textContent = p.quoted.text;
    a.querySelector('[data-testid="reply"]').addEventListener("click", () => openReply(p));
    tl.appendChild(a);
  }

  function openReply(p) {
    document.querySelector('[role="dialog"]')?.remove();
    const d = document.createElement("div");
    d.setAttribute("role", "dialog");
    d.innerHTML = `<p class="to">Replying to @${p.handle}</p>
      <div class="row"><div class="avatar" style="background:#334155">Y</div><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div></div>
      <div class="foot"><button class="send" data-testid="tweetButton" type="button">Reply</button></div>`;
    document.body.appendChild(d);
    const box = d.querySelector('[role="textbox"]');
    // A rich editor handles paste itself, as the real one does.
    box.addEventListener("paste", (e) => {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });
    setTimeout(() => box.focus(), 20);
  }
})();
