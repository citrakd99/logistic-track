/**
 * Seed.gs — migrasi satu kali dari artefak lama "Tracking Stock".
 * Artefak lama belum punya transaksi stok; yang dibawa hanya 27 penanda kategori "Alat"
 * yang diubah manual di aplikasi lama.
 * Jalankan SEKALI dari editor setelah sumber data diatur di halaman Pengaturan.
 */
var LEGACY_KAT_ALAT = [
  'subpanel34|unit', 'webbingslingbelt2tpanjang3m|pcs', 'webbingslingbelt2tpanjang6m|pcs', 'pipascapoldingdia15tebal32mmpjng2mtr|batang',
  'paneltemporaryfactoryf2|unit', 'paneltemporaryfactoryf4|unit', 'slevecoupler|pcs', 'pipascapoldingdia15tebal32mmpjng6mtr|batang',
  'tespentekiro|pcs', 'clampmati|pcs', 'spancrew16mmtrunbuckle|pcs', 'stikcone|pcs', 'clamphidup|pcs', 'subpanel12|unit',
  'theodolitedigitalextopcon|unit', 'vacumacvalve|unit', 'jackbase60cm|pcs', 'slingbaja6mm|meter', 'lampusorotled250wattexlokal|unit',
  'fullbodyharnesdoublehockabsober|unit', 'pipascapoldingdia15tebal32mmpjng1mtr|batang', 'paneltemporaryoffice|unit',
  'twistcableal4x1x25mm|meter', 'asiba1meter|pcs', 'fullbodyharnesdoublehock|unit', 'asiba2meter|pcs', 'sarungtanganlistrik1000v|pasang'
];
var LEGACY_NAMES = {
  'subpanel34|unit': 'Sub Panel 3&4', 'webbingslingbelt2tpanjang3m|pcs': 'Webbing Sling Belt 2T Panjang 3M', 'webbingslingbelt2tpanjang6m|pcs': 'Webbing Sling Belt 2T Panjang 6M',
  'pipascapoldingdia15tebal32mmpjng2mtr|batang': 'pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 2 mtr', 'paneltemporaryfactoryf2|unit': 'Panel Temporary Factory F2',
  'paneltemporaryfactoryf4|unit': 'Panel Temporary Factory F4', 'slevecoupler|pcs': 'Sleve coupler', 'pipascapoldingdia15tebal32mmpjng6mtr|batang': 'Pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 6 mtr',
  'tespentekiro|pcs': 'Tespen Tekiro', 'clampmati|pcs': 'Clamp mati', 'spancrew16mmtrunbuckle|pcs': 'Span Crew 16mm/Trunbuckle', 'stikcone|pcs': 'Stik Cone',
  'clamphidup|pcs': 'Clamp hidup', 'subpanel12|unit': 'Sub Panel 1&2', 'theodolitedigitalextopcon|unit': 'Theodolite digital ex.Topcon', 'vacumacvalve|unit': 'Vacum Ac Valve',
  'jackbase60cm|pcs': 'Jack Base 60cm', 'slingbaja6mm|meter': 'Sling Baja 6mm', 'lampusorotled250wattexlokal|unit': 'lampu sorot LED 250 Watt Ex. Lokal',
  'fullbodyharnesdoublehockabsober|unit': 'Full Body Harnes Double Hock + Absober', 'pipascapoldingdia15tebal32mmpjng1mtr|batang': 'pipa Scapolding Dia 1.5 tebal 3,2 mm pjng 1 mtr',
  'paneltemporaryoffice|unit': 'Panel Temporary Office', 'twistcableal4x1x25mm|meter': 'Twist Cable AL 4x1x25mm', 'asiba1meter|pcs': 'asiba 1 meter',
  'fullbodyharnesdoublehock|unit': 'Full Body Harnes Double Hock', 'asiba2meter|pcs': 'asiba 2 meter', 'sarungtanganlistrik1000v|pasang': 'Sarung Tangan Listrik 1000 V'
};

function seedKategoriAlatDariAppLama() {
  var ss = db_(), have = {};
  readTable_(ss, 'ITEMS').forEach(function (o) { have[o.key] = 1; });
  var add = LEGACY_KAT_ALAT.filter(function (k) { return !have[k]; }).map(function (k) {
    return { key: k, name: LEGACY_NAMES[k], unit: k.split('|')[1], kat: 'Alat', hidden: false, full: false, source: 'override', updatedAt: Date.now(), updatedBy: 'migrasi-app-lama' };
  });
  appendRows_(ss, 'ITEMS', add);
  bumpDataVersion_();
  console.log('Ditambahkan ' + add.length + ' penanda kategori Alat (dilewati ' + (LEGACY_KAT_ALAT.length - add.length) + ' yang sudah ada).');
}
