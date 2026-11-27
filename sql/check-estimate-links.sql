-- ====================================================================
--  CHECK: MEASUREMENT JOBS LINKED TO THE WRONG ACCESS CUSTOMER
--  Run this in the Supabase SQL editor. SAFE TO RUN TWICE: it only
--  reads, and changes nothing.
-- ====================================================================
--
--  Andrew, 26 Nov 2026: "the estimate number is linking to the wrong
--  order". Estimate numbers (EstimateID) and job numbers (OrderNo) run
--  through the same range in Access, so a job number typed into the
--  estimate box linked whoever has that number as an estimate.
--
--  The first result says how often one number is both. The second lists
--  every linked job that shares no name at all with the Access customer it is
--  linked to, and, where another Access customer has the linked number as
--  a JOB number and does share the name, names that one: that is the
--  job number mix up, and the customer it should be linked to.

select count(*) as estimate_numbers_in_the_list,
       count(*) filter (where exists (select 1 from public.access_customers b
                                       where b.order_no = a.estimate_id::text
                                         and b.estimate_id <> a.estimate_id)) as also_another_customers_job_number,
       min(a.estimate_id) as lowest_estimate, max(a.estimate_id) as highest_estimate,
       (select min(nullif(regexp_replace(order_no, '\D', '', 'g'), '')::bigint) from public.access_customers) as lowest_job,
       (select max(nullif(regexp_replace(order_no, '\D', '', 'g'), '')::bigint) from public.access_customers) as highest_job
  from public.access_customers a;

with j as (
  select j.id, j.customer, j.access_estimate_id, j.access_link, j.access_linked_by, j.access_linked_at,
         array(select w from regexp_split_to_table(lower(coalesce(j.customer, '')), '[^a-zà-ɏ]+') w
                where length(w) >= 2) as words
    from public.jobs j
   where j.access_estimate_id is not null
), named as (
  select j.*, a.first_name, a.last_name, a.order_no,
         array(select w from regexp_split_to_table(lower(concat_ws(' ', a.first_name, a.last_name)), '[^a-zà-ɏ]+') w
                where length(w) >= 2) as access_words
    from j left join public.access_customers a on a.estimate_id = j.access_estimate_id
)
select n.customer as job_in_the_app,
       n.access_estimate_id as linked_estimate,
       concat_ws(' ', n.first_name, n.last_name) as linked_access_customer,
       n.access_link as how_linked, n.access_linked_by as linked_by, n.access_linked_at::date as linked_on,
       b.estimate_id as should_be_estimate,
       concat_ws(' ', b.first_name, b.last_name) as should_be_customer,
       case when b.estimate_id is not null then 'job number typed as an estimate number'
            when n.last_name is null then 'that estimate is no longer in the Access list'
            else 'the names differ, check by hand' end as what_happened
  from named n
  left join lateral (
         select b.* from public.access_customers b
          where b.order_no = n.access_estimate_id::text and b.estimate_id <> n.access_estimate_id
            and exists (select 1 from regexp_split_to_table(lower(concat_ws(' ', b.first_name, b.last_name)), '[^a-zà-ɏ]+') w
                         where length(w) >= 2 and w = any(n.words))
          limit 1) b on true
 where cardinality(n.words) > 0
   and not (n.access_words && n.words)
 order by (b.estimate_id is null), n.access_linked_at desc nulls last;
