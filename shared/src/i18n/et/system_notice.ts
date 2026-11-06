import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.v3_photos.title': 'Fotod on versioonis 3.0 kolinud',
  'system_notice.v3_photos.body':
    'Reisiplaneerija **Fotod** on eemaldatud. Sinu fotod on alles — TREK ei muutnud kunagi sinu Immichi või Synology kogu.\n\nFotod asuvad nüüd lisamoodulis **Reisilugu**. See on valikuline — kui see pole veel saadaval, palu administraatoril see lubada jaotises Haldus → Lisamoodulid.',
  'system_notice.v3_journey.title': 'Tutvu reisipäevikuga',
  'system_notice.v3_journey.body':
    'Jäädvusta oma reisid lugudena koos ajajoonte, fotogaleriide ja interaktiivsete kaartidega.',
  'system_notice.v3_journey.cta_label': 'Ava reisilood',
  'system_notice.v3_journey.highlight_timeline': 'Päevade kaupa ajajoon ja galerii',
  'system_notice.v3_journey.highlight_photos': 'Import Immichist või Synologyst',
  'system_notice.v3_journey.highlight_share': 'Jaga avalikult — sisselogimine pole vajalik',
  'system_notice.v3_journey.highlight_export': 'Ekspordi PDF-fotoraamatuna',
  'system_notice.v3_features.title': 'Veel uuendusi versioonis 3.0',
  'system_notice.v3_features.body': 'Veel mõned asjad, mida selle väljalaske kohta teada.',
  'system_notice.v3_features.highlight_dashboard': 'Uus, mobiilile kohandatud avaleht',
  'system_notice.v3_features.highlight_offline': 'Täielik võrguühenduseta režiim PWA-na',
  'system_notice.v3_features.highlight_search': 'Reaalajas automaattäide kohaotsingus',
  'system_notice.v3_features.highlight_import': 'Kohtade import KMZ/KML-failidest',
  'system_notice.v3_mcp.title': 'MCP: uuendus OAuth 2.1-le',
  'system_notice.v3_mcp.body':
    'MCP-liidestus on täielikult uuendatud. Soovitatav autentimisviis on nüüd OAuth 2.1. Vanad staatilised pääsmed (trek_…) on aegunud ja eemaldatakse tulevases versioonis.',
  'system_notice.v3_mcp.highlight_oauth': 'Soovitatav on OAuth 2.1 (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 üksikasjalikku õiguste ulatust',
  'system_notice.v3_mcp.highlight_deprecated': 'Staatilised trek_-pääsmed on aegunud',
  'system_notice.v3_mcp.highlight_tools': 'Laiendatud tööriistad ja viibad',
  'system_notice.v3_thankyou.title': 'Isiklik sõnum minult',
  'system_notice.v3_thankyou.body':
    'Enne kui lähed, tahaksin korraks peatuda.\n\nTREK sai alguse kõrvalprojektina minu enda reiside jaoks. Ma ei osanud kujutleda, et sellest saab midagi, mida 4000 teist nüüd oma seikluste planeerimiseks usaldab. Iga täht, iga veateade, iga funktsioonisoov — loen neid kõiki ja need annavad mulle jõudu täiskohaga töö ja ülikooli kõrvalt hilisõhtuti jätkata.\n\nTahan, et teaksid: TREK jääb alati avatud lähtekoodiga, ise majutatavaks ja sinu omaks. Ei jälgimist, tellimusi ega varjatud tingimusi. Lihtsalt tööriist inimeselt, kes armastab reisimist sama palju kui sina.\n\nEriline tänu kasutajale [jubnl](https://github.com/jubnl) — sinust on saanud suurepärane kaasautor. Nii paljus selles, mis teeb versiooni 3.0 heaks, on sinu käekiri. Aitäh, et uskusid projekti juba siis, kui see oli veel konarlik.\n\nJa kõigile, kes teatasid veast, tõlkisid teksti, jagasid TREKi sõbraga või lihtsalt kasutasid seda reisi planeerimiseks — **aitäh**. Tänu teile on see olemas.\n\nPalju uusi ühiseid seiklusi!\n\n— Maurice\n\n---\n\n[Liitu kogukonnaga Discordis](https://discord.gg/7Q6M6jDwzf)\n\nKui TREK teeb sinu reisid paremaks, aitab [väike kohv](https://ko-fi.com/mauriceboe) arendusel jätkuda.',
  'system_notice.v3014_whitespace_collision.title': 'Vajalik toiming: kasutajakontode konflikt',
  'system_notice.v3014_whitespace_collision.body':
    'Versioonile 3.0.14 uuendamine tuvastas salvestatud kontode alguses või lõpus olevatest tühikutest põhjustatud kasutajanimede või e-posti aadresside kattuvusi. Mõjutatud kontod nimetati automaatselt ümber. Ülevaatamist vajavate kontode leidmiseks otsi serveri logist ridu, mis algavad tekstiga **[migration] WHITESPACE COLLISION**.',
  'system_notice.welcome_v1.title': 'Tere tulemast TREKi',
  'system_notice.welcome_v1.body':
    'Sinu terviklik reisiplaneerija. Koosta reisiplaane, jaga reise sõpradega ja hoia kõik korras — nii võrgus kui ka võrguühenduseta.',
  'system_notice.welcome_v1.cta_label': 'Planeeri reis',
  'system_notice.welcome_v1.hero_alt': 'Maaliline reisisihtkoht TREKi planeerimisvaatega',
  'system_notice.welcome_v1.highlight_plan': 'Päevaplaanid igaks reisiks',
  'system_notice.welcome_v1.highlight_share': 'Tee reisikaaslastega koostööd',
  'system_notice.welcome_v1.highlight_offline': 'Töötab mobiilis võrguühenduseta',
  'system_notice.dev_test_modal.title': '[Dev] Testteade',
  'system_notice.dev_test_modal.body': 'See on ainult arenduskeskkonna testteade.',
  'system_notice.pager.prev': 'Eelmine teade',
  'system_notice.pager.next': 'Järgmine teade',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Ava teade {n}',
  'system_notice.pager.position': 'Teade {current} / {total}',
};
export default system_notice;
