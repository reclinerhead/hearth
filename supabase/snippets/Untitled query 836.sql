select
  n.nspname as schema_name,
  r.rolname as role_name,
  has_schema_privilege(r.rolname, n.nspname, 'USAGE') as has_usage,
  has_schema_privilege(r.rolname, n.nspname, 'CREATE') as has_create
from pg_namespace n
cross join pg_roles r
where n.nspname = 'hearth'
  and r.rolname in ('anon', 'authenticated', 'service_role', 'postgres')
order by r.rolname;