-- ConnectMe Phase 1: types and helpers
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create type app_role        as enum ('customer','provider','verifier','support','finance','admin');
create type provider_status as enum ('draft','submitted','in_review','needs_info','approved','rejected','suspended');
create type request_status  as enum ('draft','open','offers_received','accepted','expired','cancelled');
create type offer_status    as enum ('sent','accepted','rejected','withdrawn','expired');
create type job_status      as enum ('awaiting_payment','paid_held','on_the_way','arrived','working',
                                     'completed_by_provider','confirmed','paid_out',
                                     'cancelled','disputed','refunded','split_resolved');
create type milestone_status as enum ('pending','paid_held','released','refunded');
create type check_type      as enum ('nin','face_match','bank_match','guarantor','address','credential','reference','background');
create type check_status    as enum ('not_checked','pending','pass','fail','review');
create type doc_type        as enum ('id_photo','selfie','address_proof','credential','portfolio','other');
create type dispute_status  as enum ('open','resolved');
create type dispute_reason  as enum ('no_show','poor_work','price_changed','damage','safety','other');
create type pay_status      as enum ('initiated','success','failed','refunded');
create type payout_status   as enum ('pending','sent','failed');

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
