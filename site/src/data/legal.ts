// Legal texts. Croatian is the official version, English is a translation (legalPage.official says so on the page).
//
// Rules: Dunia's own text from the homepage doc (2026-11-17), HR and EN. Two changes on 2026-11-19, both Antun's:
// the late-arrival line says entry after the start is not guaranteed, and the open "consequence for unlimited
// packs" sentence is left out until it is decided.
// Terms and privacy: DRAFTS written by Antun and Claude from facts already in the project. They are not legal advice.
// Every { todo } block is a fact nobody has confirmed. It renders as a Placeholder, so `LAUNCH=1` fails while any is left.
// Dunia's lawyer approves the Croatian text before launch, then the English translation.
export type Block = { h: string } | { p: string } | { ul: string[] } | { todo: string };
export type LegalKey = 'rules' | 'terms' | 'privacy';
type Doc = Record<LegalKey, Block[]>;

const company = {
  hr: 'Točkica na i j.d.o.o., OIB 37892279693, Ulica Antuna Bauera 22, Zagreb. E-mail: info@tockicanai.hr.',
  en: 'Točkica na i j.d.o.o., OIB 37892279693, Ulica Antuna Bauera 22, Zagreb. E-mail: info@tockicanai.hr.',
};

export const legal: { hr: Doc; en: Doc } = {
  hr: {
    rules: [
      {
        ul: [
          'Rezervacije: trening se može rezervirati do 2 tjedna unaprijed. Termin je potvrđen tek nakon uspješne rezervacije.',
          'Otkazivanje: trening se može otkazati najkasnije 6 sati prije početka.',
          'Kasno otkazivanje i nedolazak: jedan kredit s tvog profila smatra se iskorištenim.',
          'Lista čekanja: ako se oslobodi mjesto, osobe s liste čekanja dobivaju mogućnost rezervacije prema redoslijedu i pravilima sustava.',
          'Paketi i krediti: svaki paket ima svoje trajanje i datum početka valjanosti. Uvjeti paketa određuju može li se paket pauzirati i je li prenosiv na drugu osobu.',
          'Unlimited ponude: neprenosive su i koriste se isključivo preko računa osobe koja ih je kupila. Rezervacije ovise o dostupnosti mjesta i ne jamče mjesto na određenom treningu.',
          'Kašnjenje: nakon početka treninga ulazak se ne može jamčiti zbog namještanja bicikla i sigurnosti.',
          'Prvi dolazak: ako dolaziš prvi put, dođi 15 minuta ranije kako bi se upoznao/la sa studijem i konceptom treninga te namjestio/la bicikl.',
          'Oprema: čiste tenisice obavezne su. Voda i ručnik su preporučeni. Svježi ručnici i voda dostupni su u studiju prema dostupnosti.',
          'Otkazivanje treninga od strane Točkice: kredit se automatski vraća na tvoj profil. Točkica zadržava pravo zamijeniti instruktora bez otkazivanja termina.',
          'Osobne stvari: studio ne preuzima odgovornost za stvari ostavljene bez nadzora, u granicama dopuštenim zakonom.',
        ],
      },
      { todo: 'trajanje paketa, početak valjanosti, pauziranje i prijenos (Dunia, uvjeti svakog paketa)' },
      { todo: 'posljedica ponovljenih kasnih otkazivanja ili nedolazaka za unlimited paket (još nije odlučeno)' },
      { p: company.hr },
    ],
    terms: [
      {
        p: 'Ovi uvjeti vrijede za korištenje web stranice i sustava za rezervaciju Točkice na i. Pravila ponašanja u studiju i otkazivanja nalaze se u Pravilniku studija.',
      },
      { h: '1. Tko smo' },
      { p: company.hr },
      { h: '2. Korisnički račun' },
      {
        ul: [
          'Za rezervaciju treninga trebaš račun. Prijavljuješ se e-mailom i lozinkom ili Google računom.',
          'Jedan račun je za jednu osobu. Podaci koje upišeš moraju biti točni.',
          'Za svoj račun i lozinku odgovaraš sam/a. Ako sumnjaš da je netko drugi koristi, javi nam se.',
        ],
      },
      { todo: 'najmanja dob za otvaranje računa i trening' },
      { h: '3. Rezervacije i otkazivanja' },
      {
        p: 'Trening možeš rezervirati do 2 tjedna unaprijed, a otkazati najkasnije 6 sati prije početka. Što se događa kod kasnog otkazivanja i nedolaska piše u Pravilniku studija.',
      },
      { h: '4. Paketi, krediti i plaćanje' },
      {
        ul: [
          'Cijene su izražene u eurima.',
          'Paket kupuješ na web stranici. Krediti se na tvoj račun dodaju nakon plaćanja.',
          'Jedan kredit vrijedi za jedan trening.',
          'Ponuda za prvi dolazak može se kupiti jednom po računu.',
          'Plaćanje kartice obrađuje pružatelj plaćanja. Točkica ne vidi niti sprema podatke o tvojoj kartici.',
        ],
      },
      { todo: 'je li PDV uključen u cijene' },
      { todo: 'pružatelj plaćanja i način izdavanja računa (fiskalizacija)' },
      { todo: 'koliko dugo vrijedi svaki paket i što se događa s neiskorištenim kreditima' },
      { h: '5. Launch ponuda' },
      {
        p: 'Launch ponuda (30 dana neograničenih vožnji) neprenosiva je i može je koristiti samo osoba čiji je korisnički račun povezan s ponudom. Jednokratna je, bez pauziranja i povrata. Rezervacije ovise o dostupnosti mjesta na treningu.',
      },
      { h: '6. Povrat novca' },
      { todo: 'pravila povrata za pakete, rok za odustajanje i pravo potrošača' },
      { h: '7. Izjava prije prvog treninga' },
      {
        p: 'Prije prvog treninga prihvaćaš izjavu o zdravstvenom stanju i preuzimanju rizika. Prihvaćanje spremamo s datumom.',
      },
      { h: '8. Zaštita podataka' },
      { p: 'Kako postupamo s tvojim osobnim podacima piše na stranici Privatnost.' },
      { h: '9. Izmjene uvjeta' },
      {
        p: 'Uvjete možemo mijenjati. Novi uvjeti vrijede od dana objave na ovoj stranici. Ako se promjena tiče paketa koje si već kupio/la, ona se ne primjenjuje na te pakete.',
      },
      { h: '10. Mjerodavno pravo' },
      { todo: 'mjerodavno pravo i nadležni sud (pravnik)' },
    ],
    privacy: [
      { p: 'Ovdje piše koje osobne podatke prikupljamo, zašto, tko ih još vidi i što možeš tražiti od nas.' },
      { h: '1. Voditelj obrade' },
      { p: company.hr },
      { h: '2. Koje podatke prikupljamo i zašto' },
      {
        ul: [
          'Lista čekanja i korisnički račun: ime, prezime, e-mail i datum rođenja. Koristimo ih da napravimo tvoj račun, javimo ti kako kupiti ponudu i rezervirati termine te da s tobom proslavimo rođendan u studiju. Osnova: ugovor, a za datum rođenja tvoja privola.',
          'Prijava: lozinku spremamo samo kao sažetak iz kojeg se ne može pročitati. Ako se prijaviš Google računom, od Googlea dobivamo e-mail i ime.',
          'Rezervacije i dolasci: koji si trening i bicikl rezervirao/la, otkazivanja, dolazak na trening (bilježi se na recepciji) i broj treninga. Koristimo ih za rad studija, pravila otkazivanja i besplatan trening za 50., 100. i 150. trening. Osnova: ugovor.',
          'Plaćanja: što si kupio/la, iznos i datum. Podatke o kartici ne vidimo i ne spremamo, obrađuje ih pružatelj plaćanja. Račune čuvamo koliko to traži zakon. Osnova: ugovor i zakonska obveza.',
          'Izjava prije prvog treninga: ime, prezime, kontakt podaci, kontakt za hitne slučajeve, izjava o zdravstvenom stanju i datum prihvaćanja. Osnova: tvoja privola.',
          'Poruke iz kontakt obrasca: ime, e-mail i tekst poruke. Koristimo ih da ti odgovorimo. Osnova: naš legitimni interes da odgovorimo na upit.',
          'Stare članarine iz 2026.: ako ti je ostalo neiskorištenih treninga, povezujemo ih s tvojim računom preko e-mail adrese.',
          'Fotografije i snimke u studiju: povremeno snimamo promotivni sadržaj. Ako ne želiš biti u kadru, reci nam prije treninga.',
        ],
      },
      { todo: 'pravna osnova za fotografije i snimke u studiju (privola ili legitimni interes)' },
      { h: '3. Tko još vidi podatke' },
      { p: 'Podatke ne prodajemo. Koristimo pružatelje koji obrađuju podatke za nas:' },
      {
        ul: [
          'Supabase: baza podataka i prijava. Poslužitelji su u Frankfurtu (EU).',
          'Netlify: hosting web stranice i sustava, EU regija.',
          'Google: samo ako se prijaviš Google računom.',
          'Spotify: na stranicama instruktora prikazuje se Spotify playlista. Čim otvoriš takvu stranicu, Spotify prima tvoju IP adresu i može postaviti svoje kolačiće.',
        ],
      },
      { todo: 'pružatelj plaćanja (naziv, sjedište)' },
      { todo: 'pružatelj za slanje e-pošte (naziv, sjedište)' },
      {
        todo: 'prijenos podataka izvan EU (npr. Google, Spotify): standardne ugovorne klauzule ili odluka o primjerenosti',
      },
      { h: '4. Koliko dugo čuvamo podatke' },
      {
        p: 'Podatke o računu i rezervacijama čuvamo dok imaš račun. Ako zatražiš brisanje, brišemo ih, osim onoga što zakon traži da čuvamo, na primjer račune.',
      },
      { todo: 'rokovi čuvanja (račun, rezervacije, izjava, računovodstvene evidencije)' },
      { h: '5. Kolačići' },
      {
        p: 'Za prijavu koristimo kolačić sesije koji traje do 30 dana. Bez njega ne možeš ostati prijavljen/a. Kolačiće treće strane postavlja Spotify na stranicama instruktora, kako je gore opisano.',
      },
      { todo: 'usklađenost s bannerom za kolačiće i analitikom (koji kolačići se stvarno postavljaju)' },
      { h: '6. Tvoja prava' },
      {
        ul: [
          'pristup svojim podacima i kopija,',
          'ispravak netočnih podataka,',
          'brisanje podataka,',
          'ograničenje obrade,',
          'prenosivost podataka,',
          'prigovor na obradu,',
          'povlačenje privole u bilo kojem trenutku. Povlačenje ne mijenja zakonitost obrade prije toga.',
        ],
      },
      {
        p: 'Piši nam na info@tockicanai.hr. Odgovaramo u roku od mjesec dana. Ako smatraš da obrađujemo podatke protivno propisima, možeš podnijeti pritužbu Agenciji za zaštitu osobnih podataka (AZOP, azop.hr).',
      },
      { h: '7. Marketinške poruke' },
      {
        p: 'Za sada ne šaljemo newsletter ni marketinške e-mailove. Ako to uvedemo, tražit ćemo posebnu privolu, odvojenu od ove politike.',
      },
      { h: '8. Izmjene' },
      { p: 'Ako promijenimo ovu politiku, nova verzija ovdje vrijedi od dana objave.' },
      { todo: 'pravnik pregledava cijeli tekst prije objave' },
    ],
  },
  en: {
    rules: [
      {
        ul: [
          'Bookings: Classes can be booked up to 2 weeks in advance. Your spot is confirmed only once the booking has been successfully completed.',
          'Cancellations: Classes can be cancelled up to 6 hours before the scheduled start time.',
          'Late cancellation / no-show: One credit from your account will be considered used.',
          'Waitlist: If a spot becomes available, users on the waitlist will be given the opportunity to book according to the order and rules of the booking system.',
          'Packages and credits: Each package has its own validity period and activation date. The package terms will specify whether it can be paused and whether it is transferable to another person.',
          'Unlimited offers: Unlimited offers are non-transferable and may only be used through the account of the person who purchased them. All bookings are subject to class availability and do not guarantee a spot in any specific class.',
          'Late arrival: For spin classes, entry after the class has started cannot be guaranteed due to bike setup and safety considerations.',
          'First visit: If it is your first time, please arrive 15 minutes early to familiarise yourself with the studio and class concept and to set up your bike.',
          'Equipment: Clean indoor shoes are required. Water and a towel are recommended. Fresh towels and water are available at the studio according to availability.',
          'Class cancellation by Točkica: If Točkica cancels a class, the credit will automatically be returned to your account. Točkica reserves the right to substitute the instructor without cancelling the class.',
          'Personal belongings: The studio is not responsible for personal belongings left unattended, to the extent permitted by law.',
        ],
      },
      { todo: 'pack validity, activation, pause and transfer terms (Dunia, terms of each pack)' },
      { todo: 'consequence of repeated late cancellations or no-shows on an unlimited pack (not decided yet)' },
      { p: company.en },
    ],
    terms: [
      {
        p: 'These terms apply to using the Točkica na i website and booking system. Behaviour in the studio and cancellations are covered in the Studio rules.',
      },
      { h: '1. Who we are' },
      { p: company.en },
      { h: '2. Your account' },
      {
        ul: [
          'You need an account to book a class. You sign in with an email and password or with a Google account.',
          'One account is for one person. The details you enter must be correct.',
          'You are responsible for your account and password. If you think someone else is using your account, tell us.',
        ],
      },
      { todo: 'minimum age for an account and for classes' },
      { h: '3. Bookings and cancellations' },
      {
        p: 'You can book a class up to 2 weeks ahead and cancel up to 6 hours before it starts. The Studio rules say what happens after a late cancellation or a no-show.',
      },
      { h: '4. Packs, credits and payment' },
      {
        ul: [
          'Prices are in euros.',
          'You buy a pack on the website. Credits are added to your account after payment.',
          'One credit is good for one class.',
          'The first-visit offer can be bought once per account.',
          'Card payments are handled by the payment provider. Točkica does not see or store your card details.',
        ],
      },
      { todo: 'whether VAT is included in the prices' },
      { todo: 'payment provider and how receipts are issued (fiscalisation)' },
      { todo: 'how long each pack is valid and what happens to unused credits' },
      { h: '5. Launch offer' },
      {
        p: 'The launch offer (30 days of unlimited rides) is non-transferable and may only be used by the person whose account is linked to the offer. It is a one-time offer, with no pauses or refunds. Bookings are subject to class availability.',
      },
      { h: '6. Refunds' },
      { todo: 'refund rules for packs, withdrawal period and consumer rights' },
      { h: '7. Declaration before your first class' },
      {
        p: 'Before your first class you accept a declaration about your health and the risks of exercising. We store your acceptance with the date.',
      },
      { h: '8. Data protection' },
      { p: 'How we handle your personal data is described on the Privacy page.' },
      { h: '9. Changes to these terms' },
      {
        p: 'We may change these terms. New terms apply from the day they are published on this page. A change does not apply to packs you have already bought.',
      },
      { h: '10. Governing law' },
      { todo: 'governing law and competent court (lawyer)' },
    ],
    privacy: [
      { p: 'This page says what personal data we collect, why, who else sees it and what you can ask of us.' },
      { h: '1. Who is responsible' },
      { p: company.en },
      { h: '2. What data we collect and why' },
      {
        ul: [
          'Waitlist and account: first name, last name, email and date of birth. We use them to create your account, tell you how to buy the offer and book classes, and to celebrate your birthday with you in the studio. Basis: contract, and your consent for the date of birth.',
          'Sign-in: we store your password only as a hash that cannot be read back. If you sign in with Google, we receive your email and name from Google.',
          'Bookings and attendance: which class and bike you booked, cancellations, whether you came (recorded at reception) and your number of classes. We use them to run the studio, apply the cancellation rules and give you a free class for your 50th, 100th and 150th class. Basis: contract.',
          'Payments: what you bought, the amount and the date. We do not see or store your card details, the payment provider handles them. We keep invoices as long as the law requires. Basis: contract and legal obligation.',
          'Declaration before your first class: first name, last name, contact details, emergency contact, a statement about your health and the date you accepted it. Basis: your consent.',
          'Messages from the contact form: your name, email and the message. We use them to reply. Basis: our legitimate interest in answering your enquiry.',
          'Old 2026 memberships: if you have unused classes left, we link them to your account by email address.',
          'Photos and video in the studio: we occasionally film promotional content. If you do not want to be in the shot, tell us before class.',
        ],
      },
      { todo: 'legal basis for photos and video in the studio (consent or legitimate interest)' },
      { h: '3. Who else sees your data' },
      { p: 'We do not sell your data. Providers process data for us:' },
      {
        ul: [
          'Supabase: database and sign-in. The servers are in Frankfurt (EU).',
          'Netlify: hosting of the website and booking system, EU region.',
          'Google: only if you sign in with a Google account.',
          'Spotify: instructor pages show a Spotify playlist. As soon as you open such a page, Spotify receives your IP address and may set its own cookies.',
        ],
      },
      { todo: 'payment provider (name, seat)' },
      { todo: 'email sending provider (name, seat)' },
      {
        todo: 'transfers outside the EU (for example Google, Spotify): standard contractual clauses or adequacy decision',
      },
      { h: '4. How long we keep your data' },
      {
        p: 'We keep account and booking data while you have an account. If you ask us to delete it, we do, except what the law requires us to keep, such as invoices.',
      },
      { todo: 'retention periods (account, bookings, declaration, accounting records)' },
      { h: '5. Cookies' },
      {
        p: 'We use a session cookie for sign-in that lasts up to 30 days. Without it you cannot stay signed in. Spotify sets third-party cookies on instructor pages, as described above.',
      },
      { todo: 'check against the cookie banner and analytics (which cookies are really set)' },
      { h: '6. Your rights' },
      {
        ul: [
          'access to your data and a copy,',
          'correction of wrong data,',
          'deletion of your data,',
          'restriction of processing,',
          'data portability,',
          'objection to processing,',
          'withdrawal of consent at any time. Withdrawing does not affect processing done before.',
        ],
      },
      {
        p: 'Write to us at info@tockicanai.hr. We reply within one month. If you think we process your data against the rules, you can complain to the Croatian Personal Data Protection Agency (AZOP, azop.hr).',
      },
      { h: '7. Marketing messages' },
      {
        p: 'For now we send no newsletter or marketing emails. If we start, we will ask for separate consent, apart from this policy.',
      },
      { h: '8. Changes' },
      { p: 'If we change this policy, the new version applies from the day it is published here.' },
      { todo: 'lawyer reviews the whole text before it goes live' },
    ],
  },
};
