-- Whether a company is a real client or fixture data.
--
-- The plan states it plainly: do not send customer reminders during fixture
-- replay. Nothing enforced that. The only thing standing between a seeded
-- reference company and a live WhatsApp message was that the seed happens not to
-- create a company_contacts row -- and evaluateReminders skips a case with no
-- primary contact. That is an accident of what the seed omits, not a guard. The
-- day somebody adds contacts to the demo seed so the screens look populated,
-- every seeded company becomes a live reminder target, and nothing in the code
-- would object.
--
-- Marking the data is stronger than a switch somebody has to remember to flip:
-- a fixture company is fixture data forever, whoever later adds a phone number
-- to it and whichever code path reaches it.
--
-- Defaults to 'client' so every existing row keeps the meaning it already had.
-- The seed sets 'fixture' for the rows it creates; a company created through the
-- application is a client by construction.
alter table companies
  add column if not exists data_origin text not null default 'client'
    check (data_origin in ('client', 'fixture'));

-- The dispatcher joins this on every claim, so it is worth an index on the rare
-- value rather than a scan of the common one.
create index if not exists companies_data_origin_idx
  on companies (data_origin)
  where data_origin <> 'client';
