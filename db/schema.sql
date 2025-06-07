-- db/schema.sql
-- This file defines the structure of your 'invoices' table for the D1 database.
-- Run this command via the wrangler CLI to create your table:
-- wrangler d1 execute <DATABASE_NAME> --file=./db/schema.sql

-- Drop the table if it already exists to start fresh.
DROP TABLE IF EXISTS invoices;

-- Create the invoices table.
CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    service TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    date TEXT NOT NULL,
    attachment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Insert some initial data for testing purposes.
-- This mirrors the data that was previously hardcoded in the HTML file.
INSERT INTO invoices (provider, service, amount, status, date) VALUES
('Hector Soberano', 'Polygonal plan', 8816.00, 'Outstanding', '2022-12-05'),
('Ken Sheffler', 'VISIT Ken y Larry', 83520.58, 'Outstanding', '2022-12-05'),
('MPL', 'Weather station', 114673.66, 'Outstanding', '2023-03-06'),
('Hector Soberano', 'ZOFEMAT investigation', 200506.00, 'Outstanding', '2023-03-03'),
('Hector Soberano', 'Surplus area research', 63701.79, 'Outstanding', '2023-02-20'),
('Javier Rodriguez', 'Reconstruction of polygons', 64032.00, 'Outstanding', '2023-05-16'),
('Hector Soberano', 'Marina donation', 18560.00, 'Outstanding', '2023-05-16'),
('Hector Soberano', 'Video, RTK survey', 53940.00, 'Outstanding', '2023-06-06'),
('Ken Sheffler', 'HD video, updated plans', 372761.36, 'Outstanding', '2023-06-07'),
('Ken Sheffler', 'Assembly of mobile office', 568501.62, 'Outstanding', '2023-07-07'),
('Javier Rodriguez', 'Elaboration of plans for 10 plots', 29000.00, 'Outstanding', '2023-07-07'),
('MPL', 'Surveillance Oct 2022', 131189.04, 'Outstanding', '2022-10-31'),
('MPL', 'Surveillance Nov 2022', 131189.04, 'Outstanding', '2022-11-30'),
('MPL', 'Surveillance Dec 2022', 131189.04, 'Outstanding', '2022-12-31'),
('MPL', 'Surveillance Feb 2023', 131189.04, 'Outstanding', '2023-02-28'),
('MPL', 'Surveillance Mar 2023', 131189.04, 'Outstanding', '2023-03-31'),
('MPL', 'Surveillance Apr 2023', 131189.04, 'Outstanding', '2023-04-30'),
('MPL', 'Surveillance May 2023', 131189.04, 'Outstanding', '2023-05-31'),
('MPL', 'Surveillance Jun 2023', 131189.04, 'Outstanding', '2023-06-30'),


