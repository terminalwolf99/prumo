-- The school is "Escola Autonomia"; the platform itself is called Prumo.
alter table public.settings alter column school_name set default 'Escola Autonomia';
update public.settings set school_name = 'Escola Autonomia' where school_name = 'Projeto Autonomia';
