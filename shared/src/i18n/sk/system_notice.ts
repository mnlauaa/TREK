import type { TranslationStrings } from '../types';

const system_notice: TranslationStrings = {
  'system_notice.v3_photos.title': 'Fotografie sa v 3.0 presunuli',
  'system_notice.v3_photos.body':
    '**Fotografie** v Plánovači ciest boli odstránené. Vaše fotografie sú v bezpečí — TREK nikdy neupravoval vašu knižnicu Immich ani Synology.\n\nFotografie sú teraz v doplnku **Journey**. Journey je voliteľný — ak ešte nie je k dispozícii, požiadajte svojho správcu, aby ho aktivoval v Správa → Doplnky.',
  'system_notice.v3_journey.title': 'Spoznajte Journey — cestovný denník',
  'system_notice.v3_journey.body':
    'Dokumentujte svoje cesty ako bohaté cestovateľské príbehy s časovými osami, galériami fotiek a interaktívnymi mapami.',
  'system_notice.v3_journey.cta_label': 'Otvoriť Journey',
  'system_notice.v3_journey.highlight_timeline': 'Časová os a galéria deň po dni',
  'system_notice.v3_journey.highlight_photos': 'Import z Immich alebo Synology',
  'system_notice.v3_journey.highlight_share': 'Zdieľajte verejne — bez prihlásenia',
  'system_notice.v3_journey.highlight_export': 'Export ako PDF fotokniha',
  'system_notice.v3_features.title': 'Ďalšie novinky v 3.0',
  'system_notice.v3_features.body': 'Niekoľko ďalších vecí, ktoré o tomto vydaní stojí za to vedieť.',
  'system_notice.v3_features.highlight_dashboard': 'Redizajn nástenky mobile-first',
  'system_notice.v3_features.highlight_offline': 'Plný offline režim ako PWA',
  'system_notice.v3_features.highlight_search': 'Automatické dopĺňanie vyhľadávania miest v reálnom čase',
  'system_notice.v3_features.highlight_import': 'Import miest zo súborov KMZ/KML',
  'system_notice.v3_mcp.title': 'MCP: aktualizácia na OAuth 2.1',
  'system_notice.v3_mcp.body':
    'Integrácia MCP bola kompletne prepracovaná. OAuth 2.1 je teraz odporúčaná metóda overovania. Staršie statické tokeny (trek_…) sú zastarané a v budúcom vydaní budú odstránené.',
  'system_notice.v3_mcp.highlight_oauth': 'OAuth 2.1 odporúčané (mcp-remote)',
  'system_notice.v3_mcp.highlight_scopes': '24 jemne odstupňovaných rozsahov oprávnení',
  'system_notice.v3_mcp.highlight_deprecated': 'Statické tokeny trek_ sú zastarané',
  'system_notice.v3_mcp.highlight_tools': 'Rozšírená sada nástrojov a promptov',
  'system_notice.v3_thankyou.title': 'Osobné slovo odo mňa',
  'system_notice.v3_thankyou.body':
    'Než pôjdete ďalej — chcem sa na chvíľu zastaviť.\n\nTREK začal ako vedľajší projekt, ktorý som vytvoril pre svoje vlastné cesty. Nikdy som si nepredstavoval, že vyrastie na niečo, čomu teraz 4 000 z vás dôveruje pri plánovaní svojich dobrodružstiev. Každú hviezdičku, každý issue, každú požiadavku na funkciu — všetky ich čítam a práve ony ma držia počas neskorých nocí medzi prácou na plný úväzok a univerzitou.\n\nChcem, aby ste vedeli: TREK bude vždy open source, vždy self-hosted, vždy váš. Žiadne sledovanie, žiadne predplatné, žiadne háčiky. Len nástroj vytvorený niekým, kto miluje cestovanie rovnako ako vy.\n\nOsobitné poďakovanie patrí [jubnl](https://github.com/jubnl) — stal si sa neuveriteľným spolupracovníkom. Toľko z toho, čo robí verziu 3.0 skvelou, nesie tvoj rukopis. Ďakujem, že si veril tomuto projektu, keď bol ešte len v plienkach.\n\nA každému jednému z vás, kto nahlásil chybu, preložil reťazec, zdieľal TREK s priateľom alebo ho jednoducho použil na naplánovanie cesty — **ďakujem**. Vy ste dôvod, prečo toto existuje.\n\nNa mnoho ďalších dobrodružstiev spoločne.\n\n— Maurice\n\n---\n\n[Pridaj sa ku komunite na Discorde](https://discord.gg/7Q6M6jDwzf)\n\nAk ti TREK zlepšuje cestovanie, [malá káva](https://ko-fi.com/mauriceboe) vždy pomôže udržať svetlá rozsvietené.',
  'system_notice.v3014_whitespace_collision.title': 'Vyžaduje sa akcia: konflikt používateľského účtu',
  'system_notice.v3014_whitespace_collision.body':
    'Aktualizácia 3.0.14 zistila jeden alebo viac konfliktov používateľského mena alebo e-mailu spôsobených medzerami na začiatku/konci uložených účtov. Dotknuté účty boli automaticky premenované. Skontrolujte protokoly servera na riadky začínajúce **[migration] WHITESPACE COLLISION**, aby ste zistili, ktoré účty vyžadujú kontrolu.',
  'system_notice.welcome_v1.title': 'Vitajte v TREK',
  'system_notice.welcome_v1.body':
    'Váš komplexný plánovač ciest. Vytvárajte itineráre, zdieľajte cesty s priateľmi a majte vo všetkom poriadok — online i offline.',
  'system_notice.welcome_v1.cta_label': 'Naplánovať cestu',
  'system_notice.welcome_v1.hero_alt': 'Malebná cestovateľská destinácia s prekrytím plánovacieho rozhrania TREK',
  'system_notice.welcome_v1.highlight_plan': 'Itineráre deň po dni pre každú cestu',
  'system_notice.welcome_v1.highlight_share': 'Spolupracujte s cestovnými partnermi',
  'system_notice.welcome_v1.highlight_offline': 'Funguje offline na mobile',
  'system_notice.dev_test_modal.title': '[Dev] Testovacie oznámenie',
  'system_notice.dev_test_modal.body': 'Toto je testovacie oznámenie len pre vývoj.',
  'system_notice.pager.prev': 'Predchádzajúce oznámenie',
  'system_notice.pager.next': 'Ďalšie oznámenie',
  'system_notice.pager.counter': '{current} / {total}',
  'system_notice.pager.goto': 'Prejsť na oznámenie {n}',
  'system_notice.pager.position': 'Oznámenie {current} z {total}',
};
export default system_notice;
