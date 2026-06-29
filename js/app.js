const DashboardApp = (() => {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTX70w_-eFXNRTIpaPTJ518pVRH1mA6ixlZDvDXOjIAv8Xfgd8UbPLNjBmyvDF5gqSSDdD3D9gn-rJv/pub?output=csv';
  
  const state = {
    rawData: [],
    filteredData: [],
    dataTable: null,
    lastUpdated: null,
    refreshTimer: null, // Menyimpan ID interval aktif
    filters: { startDate: '', endDate: '', leader: '', status: '', process: '', merchant: '' }
  };

  const elements = {};

  const init = () => {
    cacheElements();
    bindEvents();
    applySavedTheme();
    initializeDataTable();
    
    // Sinkronkan filter awal dari form input DOM (mencegah reset manual)
    syncFiltersFromDOM();
    
    loadData();
    setupAutoRefresh(); // Inisialisasi interval waktu auto-refresh default
  };

  const cacheElements = () => {
    const ids = [
      'loadingOverlay', 'errorAlert', 'lastUpdateFull', 'recordCountLabel',
      'refreshButton', 'themeToggle', 'startDate', 'endDate',
      'leaderFilter', 'statusFilter', 'processFilter', 'merchantSearch', 'resetFilters',
      'autoRefreshInterval',
      'kpiAllTotal', 'kpiAllProgress', 'kpiAllPending', 'kpiAllDone', 'kpiSM', 'kpiCM', 'kpiFU'
    ];
    ids.forEach((id) => { elements[id] = document.getElementById(id); });
  };

  const bindEvents = () => {
    elements.refreshButton.addEventListener('click', loadData);
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.autoRefreshInterval.addEventListener('change', setupAutoRefresh);

    ['startDate', 'endDate', 'leaderFilter', 'statusFilter', 'processFilter'].forEach((key) => {
      elements[key].addEventListener('change', handleFilterChange);
    });

    elements.merchantSearch.addEventListener('input', debounce(handleFilterChange, 300));
    elements.resetFilters.addEventListener('click', resetFilters);
  };

  const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  };

  const setupAutoRefresh = () => {
    // Bersihkan interval yang ada sebelumnya
    if (state.refreshTimer) {
      window.clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }

    const intervalTime = parseInt(elements.autoRefreshInterval.value, 10);
    if (intervalTime > 0) {
      state.refreshTimer = window.setInterval(loadData, intervalTime);
    }
  };

  const toggleTheme = () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-bs-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-bs-theme', next);
    localStorage.setItem('dashboard-theme', next);
  };

  const applySavedTheme = () => {
    const saved = localStorage.getItem('dashboard-theme') || 'light';
    document.documentElement.setAttribute('data-bs-theme', saved);
  };

  const loadData = async () => {
    setLoading(true);
    showError('');

    try {
      const response = await fetch(CSV_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const parsed = results.data.map(mapRow).filter((item) => item && item.dateObj instanceof Date && !Number.isNaN(item.dateObj.getTime()));
          state.rawData = parsed.sort((a, b) => b.dateObj - a.dateObj);
          state.lastUpdated = new Date();

          populateLeaderFilter();
          
          // Memastikan filter lama tetap diproses pada data yang baru di-refresh
          syncFiltersFromDOM();
          applyFilters();
          
          updateLastUpdated();
          setLoading(false);
        },
        error: (err) => { throw new Error(err.message); }
      });
    } catch (error) {
      console.error(error);
      showError(`Gagal mengambil data Stream Spreadsheet: ${error.message}`);
      state.rawData = [];
      applyFilters();
      setLoading(false);
    }
  };

  const mapRow = (row) => {
    const rawDate = row['Tanggal'] || '';
    const dateObj = parseIndonesianDate(rawDate);
    return {
      tanggal: rawDate,
      dateObj,
      dateKey: formatDateKey(dateObj),
      dateTimestamp: dateObj ? dateObj.getTime() : 0,
      tid: normalizeEmpty(row['TID']),
      merchant: normalizeEmpty(row['Nama Merchant']),
      leader: normalizeEmpty(row['Leader']),
      kendala: normalizeEmpty(row['Kendala']),
      sm: parseBooleanCell(row['SM']),
      cm: parseBooleanCell(row['CM']),
      fu: parseBooleanCell(row['FU']),
      status: normalizeStatus(row['Status tiket']),
      note: normalizeEmpty(row['Note'])
    };
  };

  const normalizeEmpty = (value) => String(value || '').trim() || '-';
  const parseBooleanCell = (value) => String(value || '').trim().toUpperCase() === 'TRUE';

  const normalizeStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'pending') return 'Pending';
    if (normalized === 'on progress' || normalized === 'progress') return 'On Progress';
    if (normalized === 'done' || normalized === 'success') return 'Done';
    return 'Pending';
  };

  const parseIndonesianDate = (value) => {
    if (!value) return null;
    const parts = value.split(' ');
    const datePart = parts[0];
    const timePart = parts[1] || '00:00';
    
    let day, month, year;
    if (datePart.includes('/')) {
      [day, month, year] = datePart.split('/').map(Number);
    } else {
      [year, month, day] = datePart.split('-').map(Number);
    }
    const [hour = 0, minute = 0] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
  };

  const formatDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const syncFiltersFromDOM = () => {
    state.filters = {
      startDate: elements.startDate.value,
      endDate: elements.endDate.value,
      leader: elements.leaderFilter.value,
      status: elements.statusFilter.value,
      process: elements.processFilter.value,
      merchant: elements.merchantSearch.value.trim().toLowerCase()
    };
  };

  const handleFilterChange = () => {
    syncFiltersFromDOM();
    applyFilters();
  };

  const resetFilters = () => {
    elements.startDate.value = '';
    elements.endDate.value = '';
    elements.leaderFilter.value = '';
    elements.statusFilter.value = '';
    elements.processFilter.value = '';
    elements.merchantSearch.value = '';
    handleFilterChange();
  };

  const applyFilters = () => {
    const { startDate, endDate, leader, status, process, merchant } = state.filters;

    state.filteredData = state.rawData.filter((item) => {
      const matchesStart = !startDate || item.dateKey >= startDate;
      const matchesEnd = !endDate || item.dateKey <= endDate;
      const matchesLeader = !leader || item.leader === leader;
      const matchesStatus = !status || item.status === status;
      const matchesMerchant = !merchant || item.merchant.toLowerCase().includes(merchant);
      const matchesProcess = !process || (process === 'SM' && item.sm) || (process === 'CM' && item.cm) || (process === 'FU' && item.fu);
      return matchesStart && matchesEnd && matchesLeader && matchesStatus && matchesMerchant && matchesProcess;
    });

    updateKpis();
    updateTable();
    updateRecordCount();
  };

  const populateLeaderFilter = () => {
    const leaders = [...new Set(state.rawData.map((item) => item.leader))].sort((a, b) => a.localeCompare(b, 'id'));
    const current = elements.leaderFilter.value;
    elements.leaderFilter.innerHTML = '<option value="">Any</option>';
    leaders.forEach((leader) => {
      const option = document.createElement('option');
      option.value = leader; option.textContent = leader;
      elements.leaderFilter.appendChild(option);
    });
    // Mengunci nilai leader yang terpilih sebelumnya agar tidak hilang dari dropdown
    elements.leaderFilter.value = leaders.includes(current) ? current : '';
  };

  const updateKpis = () => {
    const data = state.filteredData;
    elements.kpiAllTotal.textContent = data.length;
    elements.kpiAllProgress.textContent = data.filter((item) => item.status === 'On Progress').length;
    elements.kpiAllPending.textContent = data.filter((item) => item.status === 'Pending').length;
    elements.kpiAllDone.textContent = data.filter((item) => item.status === 'Done').length;
    
    elements.kpiSM.textContent = data.filter(item => item.sm).length;
    elements.kpiCM.textContent = data.filter(item => item.cm).length;
    elements.kpiFU.textContent = data.filter(item => item.fu).length;
  };

  const initializeDataTable = () => {
    state.dataTable = $('#kendalaTable').DataTable({
      data: [],
      columns: [
        { data: 'tanggal', render: (data, type, row) => (type === 'sort' || type === 'type' ? row.dateTimestamp : data) },
        { data: 'tid' }, { data: 'merchant' }, { data: 'leader' }, { data: 'kendala' },
        { data: 'sm', render: renderProcessPill('SM', 'pill-sm') },
        { data: 'cm', render: renderProcessPill('CM', 'pill-cm') },
        { data: 'fu', render: renderProcessPill('FU', 'pill-fu') },
        { data: 'status', render: renderStatusBadge }, { data: 'note' }
      ],
      dom: 'Brtip',
      buttons: [
        { extend: 'excelHtml5', text: 'Excel', className: 'btn btn-sm btn-light border' },
        { extend: 'csvHtml5', text: 'CSV', className: 'btn btn-sm btn-light border' }
      ],
      pageLength: 10, responsive: true,
      language: { emptyTable: 'Tidak ada data', info: 'Showing _START_ to _END_ of _TOTAL_ entries', paginate: { previous: '‹', next: '›' } }
    });
  };

  const renderProcessPill = (label, className) => (value) => value ? `<span class="process-pill ${className}">${label}</span>` : '<span class="process-pill pill-off">-</span>';
  const renderStatusBadge = (status) => {
    const className = status === 'Pending' ? 'pending' : status === 'On Progress' ? 'progress' : 'done';
    return `<span class="badge-soft ${className}">${status}</span>`;
  };

  const updateTable = () => { 
    // Menggunakan state preservation bawaan DataTables saat memuat baris baru
    const currentPage = state.dataTable.page();
    state.dataTable.clear().rows.add(state.filteredData).draw(false); 
    state.dataTable.page(currentPage).draw('page');
  };
  
  const updateLastUpdated = () => { if (state.lastUpdated) elements.lastUpdateFull.textContent = 'Last refreshed: ' + state.lastUpdated.toLocaleTimeString('id-ID') + ' WIB'; };
  const updateRecordCount = () => { elements.recordCountLabel.textContent = `${state.filteredData.length} records found`; };
  const showError = (msg) => { if (!msg) { elements.errorAlert.classList.add('d-none'); return; } elements.errorAlert.textContent = msg; elements.errorAlert.classList.remove('d-none'); };
  const setLoading = (isLoading) => { elements.loadingOverlay.classList.toggle('d-none', !isLoading); };

  return { init };
})();

document.addEventListener('DOMContentLoaded', DashboardApp.init);