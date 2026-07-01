const DashboardApp = (() => {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTX70w_-eFXNRTIpaPTJ518pVRH1mA6ixlZDvDXOjIAv8Xfgd8UbPLNjBmyvDF5gqSSDdD3D9gn-rJv/pub?output=csv';
  
  const state = {
    rawData: [],
    filteredData: [],
    charts: {},
    dataTable: null,
    lastUpdated: null,
    refreshTimer: null,
    filters: { startDate: '', endDate: '', leader: '', status: '', process: '', merchant: '' }
  };

  const elements = {};

  const init = () => {
    cacheElements();
    bindEvents();
    applySavedTheme();
    initializeDataTable();
    
    syncFiltersFromDOM();
    loadData();
    setupAutoRefresh();
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

    const palette = getChartPalette();
    Object.keys(state.charts).forEach(chartId => {
      const chart = state.charts[chartId];
      if(chart.options.scales) {
        chart.options.scales.x.ticks.color = palette.text;
        chart.options.scales.x.grid.color = palette.grid;
        chart.options.scales.y.ticks.color = palette.text;
        chart.options.scales.y.grid.color = palette.grid;
      }
      if(chart.options.plugins && chart.options.plugins.legend) {
        chart.options.plugins.legend.labels.color = palette.text;
      }
      chart.update();
    });
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
          const parsed = results.data
            .map(mapRow)
            .filter((item) => item && item.dateObj instanceof Date && !Number.isNaN(item.dateObj.getTime()));

          state.rawData = parsed.sort((a, b) => b.dateObj - a.dateObj);
          state.lastUpdated = new Date();

          populateLeaderFilter();
          
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
      const dParts = datePart.split('/');
      day = Number(dParts[0]); month = Number(dParts[1]); year = Number(dParts[2]);
    } else if (datePart.includes('-')) {
      const dParts = datePart.split('-');
      year = Number(dParts[0]); month = Number(dParts[1]); day = Number(dParts[2]);
    } else {
      return new Date(value);
    }

    const tParts = timePart.split(':');
    const hour = Number(tParts[0] || 0);
    const minute = Number(tParts[1] || 0);
    return new Date(year, month - 1, day, hour, minute);
  };

  const formatDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const syncFiltersFromDOM = () => {
    if (!elements.startDate) return;
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
    renderLeaderChart();
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

  // PEMBARUAN: Mengubah Grafik Menjadi Stacked Bar Berdasarkan Pembagian Status
  const renderLeaderChart = () => {
    const palette = getChartPalette();
    
    // 1. Dapatkan top 10 leader berdasarkan total kendala
    const leaderCounts = {};
    state.filteredData.forEach(item => {
      const leader = item.leader || 'Tidak ditemukan';
      leaderCounts[leader] = (leaderCounts[leader] || 0) + 1;
    });
    
    const topLeaders = Object.entries(leaderCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(entry => entry[0]);

    // 2. Ekstrak jumlah status tiket masing-masing leader tersebut
    const progressData = [];
    const pendingData = [];
    const doneData = [];

    topLeaders.forEach(leader => {
      const leaderItems = state.filteredData.filter(item => item.leader === leader);
      
      progressData.push(leaderItems.filter(item => item.status === 'On Progress').length);
      pendingData.push(leaderItems.filter(item => item.status === 'Pending').length);
      doneData.push(leaderItems.filter(item => item.status === 'Done').length);
    });

    // 3. Merender grafik bertumpuk (Stacked Chart) multi-dataset
    updateOrCreateChart('leaderChart', 'bar', topLeaders, [
      {
        label: 'Done',
        data: doneData,
        backgroundColor: '#4ade80', // Hijau cerah
        borderRadius: 4
      },
      {
        label: 'On Progress',
        data: progressData,
        backgroundColor: '#60a5fa', // Biru cerah
        borderRadius: 4
      },
      {
        label: 'Pending',
        data: pendingData,
        backgroundColor: '#fbbf24', // Kuning cerah
        borderRadius: 4
      }
    ], {
      indexAxis: 'y',
      scales: {
        x: { stacked: true, ticks: { color: palette.text }, grid: { color: palette.grid } },
        y: { stacked: true, ticks: { color: palette.text }, grid: { display: false } }
      },
      plugins: {
        legend: { display: true, labels: { color: palette.text, font: { family: 'Inter' } } },
        tooltip: { backgroundColor: 'rgba(0, 0, 0, 0.85)' }
      }
    });
  };

  const updateOrCreateChart = (canvasId, type, labels, datasets, extraOptions = {}) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (state.charts[canvasId]) {
      const chart = state.charts[canvasId];
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update('active');
    } else {
      state.charts[canvasId] = new Chart(canvas, {
        type,
        data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, ...extraOptions }
      });
    }
  };

  const getChartPalette = () => {
    const theme = document.documentElement.getAttribute('data-bs-theme');
    return {
      text: theme === 'dark' ? '#e2e8f0' : '#212529',
      grid: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)'
    };
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
    if (!state.dataTable) return;
    state.dataTable.search('');
    const currentPage = state.dataTable.page();
    state.dataTable.clear().rows.add(state.filteredData).draw(false); 
    if(currentPage < state.dataTable.page.info().pages) {
        state.dataTable.page(currentPage).draw('page');
    }
  };
  
  const updateLastUpdated = () => { if (state.lastUpdated) elements.lastUpdateFull.textContent = 'Last refreshed: ' + state.lastUpdated.toLocaleTimeString('id-ID') + ' WIB'; };
  const updateRecordCount = () => { elements.recordCountLabel.textContent = `${state.filteredData.length} records found`; };
  const showError = (msg) => { if (!msg) { elements.errorAlert.classList.add('d-none'); return; } elements.errorAlert.textContent = msg; elements.errorAlert.classList.remove('d-none'); };
  const setLoading = (isLoading) => { elements.loadingOverlay.classList.toggle('d-none', !isLoading); };

  return { init };
})();

document.addEventListener('DOMContentLoaded', DashboardApp.init);