-- XAICG schema v4: sign-in now happens inside the extension (chrome.identity),
-- so the server no longer parks half-finished sign-ins.
DROP TABLE IF EXISTS auth_flows;
