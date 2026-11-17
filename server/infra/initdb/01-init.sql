-- Executado pelo entrypoint do container na primeira inicialização.
-- Papéis são cluster-wide; os bancos microzup e microzup_test herdam o owner.

CREATE ROLE microzup_app LOGIN PASSWORD 'microzup_dev_app';

CREATE DATABASE microzup_test OWNER microzup_owner;
