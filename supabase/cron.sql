-- Enable pg_cron and pg_net in Supabase Database > Extensions first.
-- Create Vault secrets in the Dashboard: dxb_origin = https://YOUR-SITE.netlify.app
-- and dxb_dispatch_secret = the same random value as Netlify DISPATCH_SECRET.
-- Run AFTER deployment. No secret is embedded in the cron command.
select cron.schedule('dxb-dispatch','30 seconds',$$
 select net.http_post(
 url := (select decrypted_secret from vault.decrypted_secrets where name='dxb_origin') || '/.netlify/functions/dispatch',
 headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='dxb_dispatch_secret')),
 body := '{}'::jsonb, timeout_milliseconds := 25000
 );
$$);
-- If seconds intervals are unsupported, replace '30 seconds' above with '* * * * *'.
-- Inspect: select * from cron.job_run_details order by start_time desc limit 20;
-- Inspect HTTP responses: select * from net._http_response order by created desc limit 20;
-- Disable: select cron.unschedule('dxb-dispatch');
