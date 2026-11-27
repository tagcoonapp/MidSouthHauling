-- Premier lots near us (from premierbuildings.us's dealer map), for the map and for placing INV Hauls.
-- "Brett Key" is left out: it's the same lot as Jeff Key Motors.
CREATE TABLE lots (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  address  TEXT NOT NULL DEFAULT '',
  phone    TEXT NOT NULL DEFAULT '',
  lat      REAL,
  lng      REAL,
  aliases  TEXT NOT NULL DEFAULT '',   -- other names used in NetSuite/job names, comma separated (e.g. "Moody")
  active   INTEGER NOT NULL DEFAULT 1
);
INSERT INTO lots (id, name, address, phone, lat, lng, aliases) VALUES
('70986111', 'A Better Way Auto LLC', '701 Englewood Dr, Madisonville, TN 37854', '423-572-0220', 35.5109444, -84.37099889999999, ''),
('60068301', 'Big Swan Sales and Rentals', '1615 Columbia Highway, Hohenwald, TN', '9318054117', 35.5630498, -87.39806720000001, ''),
('51300325', 'Brookes Buildings LLC', '40 Anderson Rd., Pontotoc, MS. 38863', '662-266-2273', 34.2204201, -88.8596498, ''),
('6692130', 'Currahee Cabins and Carports', '980 South Pond Street, Toccoa, GA', '706-391-0256', 34.5652686, -83.3278828, 'Toccoa'),
('69941280', 'Farm Club LLC', '915 Highway 72, Corinth, MS 38834', '(662) 415-5615', 34.9313114, -88.67715510000001, ''),
('69525108', 'Hwy 45 Buildings Solutions', '5534 U.S. 45, Selmer, TN 38375', '(662) 321-7563', 35.0947622, -88.55233989999999, ''),
('6182332', 'Jeff Key Motors', '2889 U.S. 431, Anniston, AL 36206', '(256) 820-0280', 33.7171914, -85.863991, 'Anniston, Brett Key'),
('66075038', 'Landers Trade', '250 E Stratton Ave, Monterey, TN 38574', '(931) 265-8431', 36.1434025, -85.2698884, ''),
('57891922', 'Little bros rentals', '63 Hazelwood Rd, 63 Hazelwood Rd, West Point, MS 39773', '6623197277', 33.6514372, -88.66631029999999, ''),
('1306498', 'Modern Living', '801 Marketta Spur Road, Moody, AL 35004', '205-640-7061', 33.57252426445484, -86.51885211467743, 'Moody'),
('69748997', 'NAR Outdoor Solutions', '3400 Hillsboro Hwy, Manchester, TN 37355', '', 35.4487777, -86.03248560000002, ''),
('48374114', 'Premier Buildings & Trailers- Huntsville', '25684 Highway 72 East, Athens, AL. 35613', '651-528-2289', 34.7843771, -86.9446645, 'Huntsville, Athens'),
('48597096', 'Premier Buildings and Trailers of Chattanooga', '8037 Standifer Gap Rd., Chattanooga, TN. 37421', '423-400-4029', 35.0440016, -85.1163989, ''),
('60576561', 'Premier Buildings and Trailers of Dickson', '3192 TN-46, Dickson, TN', '(615) 219-9196‬', 35.9832703, -87.317512, ''),
('45287338', 'Premier Buildings of Florence, AL', '4051 US HWY 72, Killen, AL. 35645', '651-528-2289', 34.8599931, -87.4997405, 'Florence, Killen'),
('3545521', 'Premier Buildings of Henagar, AL', '17153 AL HWY 175 Henagar, AL.35978', '256-657-8031', 34.6237665, -85.7567648, 'Henagar'),
('44534808', 'Premier Buildings of Hollis Crossroads', '10139 HWY 9, Heflin, AL. 36254', '256-820-0280', 33.522189, -85.6396846, 'Hollis Crossroads, Heflin'),
('37128467', 'Premier Buildings of Piedmont, Al', '351 US- 278 BYP W., Piedmont, AL. 36272', '256-399-3562', 33.9339702, -85.6015953, 'Piedmont'),
('54344459', 'Premier of Glencoe AL', '321 Chastain Blvd., Glencoe, AL. 35905', '256-399-3562', 33.960913, -85.93785009999999, 'Glencoe'),
('2864801', 'Premier of South Fulton', '317 East State Line Street, Fulton, TN', '844-879-1468', 36.50243315495258, -88.87332141653292, 'South Fulton'),
('38487211', 'Randolph County Mobile Homes', '2595 Highway 431, Roanoke, AL. 36274', '334-863-8116', 33.1424472, -85.35544929999999, ''),
('53792107', 'Sheds of Alex City', '6747 Highway 280, Alexander City, AL. 35010', '205-527-4382', 32.9070573, -85.9222814, ''),
('71678196', 'Sheds of Columbus', '4518 Gilbert Avenue, Columbus, GA', '7063084130', 32.5077127, -84.97452799999999, ''),
('66075009', 'Sheds of Riverdale', '632 Springdale Dr, Riverdale, GA, 30274', '(706) 308-4130', 33.5706538, -84.4109934, ''),
('57891923', 'Southern boy sheds and trailers  - mt juliet', '8220 Central Pike, 8220 Central Pike, Mt. Juliet, TN 37122', '629-239-1021', 36.1526722, -86.51540530000001, ''),
('45896430', 'Southern Boy Sheds and Trailers -Thomaston', '1417 US HWY 19, Thomaston, GA., 30286', '770-584-7909', 32.9313355, -84.334183, ''),
('16569230', 'Southern Boy Sheds and Trailers Griffin', '2070 Williamson Rd, Griffin, GA', '770-584-7909', 33.220593, -84.3105155, ''),
('50225995', 'Southern Boys Sheds & Trailers- winfield', '2250 US 43, Winfield, AL. 35594', '205-570-8071', 33.9388108, -87.8354813, 'Winfield'),
('49061107', 'Strickland Outdoor Products', '189 North Main St., Luthersville, GA. 30251', '678-588-4703', 33.2226704, -84.7474702, ''),
('49109969', 'Strickland Structures Douglasville', '11310 Veterans Memorial Hwy, Douglasville, GA. 30134', '478-457-4318', 33.7871468, -84.699078, ''),
('8142584', 'Suddenly Structures', '10414 Highway 22, Calera, AL', '205-527-4382', 33.1491451, -86.76707879999998, ''),
('40088941', 'Summit 22 Structures, LLC', '5291 US 76, Chatsworth, GA. 30705', '706-889-4752', 34.7824577, -84.8656307, ''),
('51402243', 'Summitt Auto', '236 Miller Ave., Crossville, TN. 38555', '931-337-0898', 35.9567765, -85.03633099999999, ''),
('29918096', 'Sylacauga Portable Buildings', '150 Blue Heron Ln. Sylacauga, AL. 35151', '256-267-9322', 33.1926347, -86.4892172, 'Sylacauga'),
('34748227', 'Vision 7 Buildings', '525 HWY 78 E. Sumiton, AL. 35148', '205-215-4155', 33.7414774, -87.0400255, 'Sumiton'),
('70640029', 'Winston Shed Co Montgomery', '2840 Birmingham Hwy, Montgomery, AL 36108', '251-597-9291', 32.3658474, -86.3655052, ''),
('3427685', 'Yoders Buildings Inc', '2528 Highway 28, Mize, MS', '601-513-7535', 31.8671872, -89.6283172, 'Mize');

-- Re-place INV Hauls on the map using the lot locations.
UPDATE jobs SET geo_status = 'none' WHERE job_type = 'inv_haul' AND stage IN ('pipeline', 'scheduled');
