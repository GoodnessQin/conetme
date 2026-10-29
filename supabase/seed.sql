-- Settings (commission is basis points: 1000 = 10%)
insert into public.settings (key, value, description) values
  ('commission_bps', '1000', 'Platform commission on each released milestone'),
  ('auto_confirm_hours', '48', 'Hours after completion before a job auto-confirms'),
  ('request_expiry_hours', '24', 'Default request lifetime'),
  ('urgent_expiry_hours', '2', 'Urgent request lifetime'),
  ('dispute_window_days', '7', 'Days after completion a dispute may be opened'),
  ('first_jobs_cap_kobo', '10000000', 'Job value cap for new providers (NGN 100,000)'),
  ('providers_notified_first', '10', 'Providers alerted immediately per request'),
  ('face_match_pass', '0.85', 'Minimum face match score to pass automatically'),
  ('face_match_review', '0.70', 'Below pass but above this goes to manual review')
on conflict (key) do nothing;

-- Services
insert into public.services (slug, name, icon, description, pricing_mode, form_schema, milestone_template, inspection_fee_kobo, callout_fee_kobo, job_cap_kobo, sort_order) values
('plumber', 'Plumber', 'wrench', 'Leaks, blocked drains, water heaters, pumps', 'fixed',
 '[{"name":"problem","label":"What is the problem?","type":"select","required":true,"options":["Leak","Blocked drain","Toilet","Water heater","Borehole pump","New installation","Other"]},
   {"name":"property","label":"Property type","type":"select","required":true,"options":["Flat","House","Office","Shop"]},
   {"name":"description","label":"Describe the job","type":"textarea","required":true}]',
 '[{"label":"Full payment","percent":100}]', 0, 300000, 10000000, 1),
('caterer', 'Caterer', 'utensils', 'Parties, weddings and office events', 'fixed',
 '[{"name":"event_type","label":"Event type","type":"select","required":true,"options":["Wedding","Naming ceremony","Birthday","Office event","Funeral","Other"]},
   {"name":"guests","label":"Number of guests","type":"number","required":true},
   {"name":"meal_type","label":"Meal style","type":"select","required":true,"options":["Buffet","Plated","Small chops","Packed meals"]},
   {"name":"budget_per_head","label":"Budget per head (naira)","type":"number","required":false},
   {"name":"services_needed","label":"Services needed","type":"multiselect","required":false,"options":["Cooking only","Serving staff","Drinks","Cake"]},
   {"name":"dietary","label":"Dietary needs","type":"textarea","required":false}]',
 '[{"label":"Deposit","percent":50},{"label":"Balance","percent":50}]', 0, 0, 10000000, 2),
('solar-installer', 'Solar panel installer', 'sun', 'Site inspection first, then a full quote', 'quote',
 '[{"name":"property","label":"Property type","type":"select","required":true,"options":["Flat","House","Office","Shop","Estate"]},
   {"name":"goal","label":"What do you want?","type":"select","required":true,"options":["Backup power","Full off-grid","Cut generator cost"]},
   {"name":"power_use","label":"Daily power use or monthly bill","type":"textarea","required":true},
   {"name":"existing","label":"Existing inverter or batteries","type":"textarea","required":false},
   {"name":"roof","label":"Roof type","type":"select","required":false,"options":["Flat concrete","Aluminium sheet","Tiles","Not sure"]},
   {"name":"budget_range","label":"Budget range","type":"text","required":false}]',
 '[{"label":"Start of work","percent":40},{"label":"Equipment installed","percent":40},{"label":"Commissioning sign-off","percent":20}]',
 1500000, 0, 500000000, 3)
on conflict (slug) do nothing;

-- Areas (approximate centroids; refine later)
insert into public.areas (name, city, state, location) values
('Lekki Phase 1','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.4723 6.4474)')),
('Victoria Island','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.4219 6.4281)')),
('Yaba','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.3711 6.5095)')),
('Surulere','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.3569 6.5010)')),
('Ikeja','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.3515 6.6018)')),
('Ajah','Lagos','Lagos', st_geogfromtext('SRID=4326;POINT(3.5852 6.4698)')),
('Wuse 2','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.4668 9.0795)')),
('Garki','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.4900 9.0300)')),
('Maitama','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.4930 9.0950)')),
('Jabi','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.4300 9.0700)')),
('Gwarinpa','Abuja','FCT', st_geogfromtext('SRID=4326;POINT(7.4000 9.1100)'))
on conflict (city, name) do nothing;
