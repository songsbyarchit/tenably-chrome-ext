Tenably Importer — Chrome Extension

What it does
Tenably Importer is a Chrome extension that scrapes property listings from SpareRoom and imports them into Tenably, an AI-powered rental platform. Instead of manually re-entering your listings, you click one button and everything transfers across automatically — title, rent, location, room type, bills, availability, furnishing, and photos.
On a search results page it detects all listings on the page and imports them all at once. On a single listing page it imports just that one. All imported listings are saved locally in your browser and displayed in the Tenably dashboard with a pre-verified applicant feed.

Setup (step by step)

Download the extension folder and unzip it
Open Chrome and go to chrome://extensions in the address bar
Toggle Developer mode on using the switch in the top right corner
Click Load unpacked
Select the unzipped folder (the one containing manifest.json)
The Tenably Importer extension will now appear in your extensions list


How to use it

Go to any SpareRoom search results page or individual listing
Look for the Import to Tenably button in the bottom right corner of the page
Click it — a preview panel slides up showing all the data it found
Click Confirm to save the listing(s) to your Tenably portfolio
The Tenably dashboard opens automatically in a new tab showing your listings and applicant cards


Files in this folder

manifest.json — tells Chrome what the extension does and where to run
content.js — runs on SpareRoom and handles the scraping and button
content.css — styles for the import button and preview panel
background.js — opens listings in background tabs for batch importing
tenably.html — the Tenably dashboard page
tenably.js — powers the dashboard with your imported listings
