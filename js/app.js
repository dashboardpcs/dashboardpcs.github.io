const DashboardApp = (() => {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTX70w_-eFXNRTIpaPTJ518pVRH1mA6ixlZDvDXOjIAv8Xfgd8UbPLNjBmyvDF5gqSSDdD3D9gn-rJv/pub?output=csv';
  const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000;

  const state = {
    rawData: [],
    filteredData: [],
    charts: {},
    dataTable: null,
    lastUpdated: null,
    filters: {
      startDate: '',
      endDate: '',
      leader: '',
      status: '',
      process: '',
      merchant: ''
    }
  };

  const elements = {};

  const init = () => {
    cacheElements();
    bindEvents();
    applySavedTheme();
    initializeDataTable();
    loadData();
    window.setInterval(loadData, AUTO_REFRESH_INTERVAL);
  };

  const cacheElements = () => {
    const ids = [
      'loadingOverlay', 'errorAlert', 'lastUpdateLabel', 'lastUpdateFull', 'recordCountLabel',
      'refreshButton', 'themeToggle', 'sidebarToggle', 'sidebar', 'startDate', 'endDate',
      'leaderFilter', 'statusFilter', 'processFilter', 'merchantSearch', 'resetFilters',
      
      // Hari Ini IDs
      'kpiTodayTotal', 'kpiTodayTotalSM', 'kpiTodayTotalCM', 'kpiTodayTotalFU',
      'kpiTodayProgress', 'kpiTodayProgressSM', 'kpiTodayProgressCM', 'kpiTodayProgressFU',
      'kpiTodayPending', 'kpiTodayPendingSM', 'kpiTodayPendingCM', 'kpiTodayPendingFU',
      
      // Akumulatif Total IDs
      'kpiAllTotal', 'kpiAllTotalSM', 'kpiAllTotalCM', 'kpiAllTotalFU',
      'kpiAllProgress', 'kpiAllProgressSM', 'kpiAllProgressCM', 'kpiAllProgressFU',
      'kpiAllPending', 'kpiAllPendingSM', 'kpiAllPendingCM', 'kpiAllPendingFU',
      'kpiAllDone', 'kpiAllDoneSM', 'kpiAllDoneCM', 'kpiAllDoneFU'
    ];

    ids.forEach((id) => { elements[id] = document.getElementById(id); });
  };

  const bindEvents = () => {
    elements.refreshButton.addEventListener('click', loadData);
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.sidebarToggle.addEventListener('click', () => elements.sidebar.classList.toggle('show'));

    ['startDate', 'endDate', 'leaderFilter', 'statusFilter', 'processFilter'].forEach((key) => {
      elements[key].addEventListener('change', handleFilterChange);
    });

    elements.merchantSearch.addEventListener('input', debounce(handleFilterChange, 300));
    elements.resetFilters.addEventListener('click', resetFilters);

    document.querySelectorAll('.sidebar-link').forEach((link) => {
      link.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-link').forEach((item) => item.classList.remove('active'));
        link.classList.add('active');
        elements.sidebar.classList.remove('show');
      });
    });
  };

  const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
  };

  const toggleTheme = () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-bs-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-bs-theme', next);
    localStorage.setItem('dashboard-theme', next);
    updateThemeIcon(next);
    
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
    updateThemeIcon(saved);
  };

  const updateThemeIcon = (theme) => {
    elements.themeToggle.innerHTML = theme === 'dark'
      ? '<i class="bi bi-brightness-high-fill"></i>'
      : '<i class="bi bi-moon-stars-fill"></i>';
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
          applyFilters();
          updateLastUpdated();
          setLoading(false);
        },
        error: (err) => { throw new Error(err.message); }
      });

    } catch (error) {
      console.error(error);
      showError(`Gagal sinkronisasi data Google Sheets: ${error.message}.`);
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

  const normalizeEmpty = (value) => String(value || '').trim() || 'Tidak ditemukan';
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

  const formatDateTimeId = (date) => new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date);

  const formatDateId = (date) => new Intl.DateTimeFormat('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric'
  }).format(date);

  const handleFilterChange = () => {
    state.filters = {
      startDate: elements.startDate.value,
      endDate: elements.endDate.value,
      leader: elements.leaderFilter.value,
      status: elements.statusFilter.value,
      process: elements.processFilter.value,
      merchant: elements.merchantSearch.value.trim().toLowerCase()
    };
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
      const matchesProcess = !process
        || (process === 'SM' && item.sm)
        || (process === 'CM' && item.cm)
        || (process === 'FU' && item.fu);

      return matchesStart && matchesEnd && matchesLeader && matchesStatus && matchesMerchant && matchesProcess;
    });

    updateKpis();
    renderCharts();
    updateTable();
    updateRecordCount();
  };

  const populateLeaderFilter = () => {
    const leaders = [...new Set(state.rawData.map((item) => item.leader))].sort((a, b) => a.localeCompare(b, 'id'));
    const current = elements.leaderFilter.value;
    elements.leaderFilter.innerHTML = '<option value="">Semua Leader</option>';

    leaders.forEach((leader) => {
      const option = document.createElement('option');
      option.value = leader;
      option.textContent = leader;
      elements.leaderFilter.appendChild(option);
    });
    elements.leaderFilter.value = leaders.includes(current) ? current : '';
  };

  const updateKpis = () => {
    const data = state.filteredData;
    const todayKey = formatDateKey(new Date());

    const dataToday = data.filter(item => item.dateKey === todayKey);
    const dataTodayProgress = dataToday.filter(item => item.status === 'On Progress');
    const dataTodayPending = dataToday.filter(item => item.status === 'Pending');

    const dataAllProgress = data.filter(item => item.status === 'On Progress');
    const dataAllPending = data.filter(item => item.status === 'Pending');
    const dataAllDone = data.filter(item => item.status === 'Done');

    // --- RENDER HARI INI ---
    elements.kpiTodayTotal.textContent = dataToday.length;
    elements.kpiTodayTotalSM.textContent = dataToday.filter(item => item.sm).length;
    elements.kpiTodayTotalCM.textContent = dataToday.filter(item => item.cm).length;
    elements.kpiTodayTotalFU.textContent = dataToday.filter(item => item.fu).length;

    elements.kpiTodayProgress.textContent = dataTodayProgress.length;
    elements.kpiTodayProgressSM.textContent = dataTodayProgress.filter(item => item.sm).length;
    elements.kpiTodayProgressCM.textContent = dataTodayProgress.filter(item => item.cm).length;
    elements.kpiTodayProgressFU.textContent = dataTodayProgress.filter(item => item.fu).length;

    elements.kpiTodayPending.textContent = dataTodayPending.length;
    elements.kpiTodayPendingSM.textContent = dataTodayPending.filter(item => item.sm).length;
    elements.kpiTodayPendingCM.textContent = dataTodayPending.filter(item => item.cm).length;
    elements.kpiTodayPendingFU.textContent = dataTodayPending.filter(item => item.fu).length;

    // --- RENDER AKUMULATIF ---
    elements.kpiAllTotal.textContent = data.length;
    elements.kpiAllTotalSM.textContent = data.filter(item => item.sm).length;
    elements.kpiAllTotalCM.textContent = data.filter(item => item.cm).length;
    elements.kpiAllTotalFU.textContent = data.filter(item => item.fu).length;

    elements.kpiAllProgress.textContent = dataAllProgress.length;
    elements.kpiAllProgressSM.textContent = dataAllProgress.filter(item => item.sm).length;
    elements.kpiAllProgressCM.textContent = dataAllProgress.filter(item => item.cm).length;
    elements.kpiAllProgressFU.textContent = dataAllProgress.filter(item => item.fu).length;

    elements.kpiAllPending.textContent = dataAllPending.length;
    elements.kpiAllPendingSM.textContent = dataAllPending.filter(item => item.sm).length;
    elements.kpiAllPendingCM.textContent = dataAllPending.filter(item => item.cm).length;
    elements.kpiAllPendingFU.textContent = dataAllPending.filter(item => item.fu).length;

    elements.kpiAllDone.textContent = dataAllDone.length;
    elements.kpiAllDoneSM.textContent = dataAllDone.filter(item => item.sm).length;
    elements.kpiAllDoneCM.textContent = dataAllDone.filter(item => item.cm).length;
    elements.kpiAllDoneFU.textContent = dataAllDone.filter(item => item.fu).length;
  };

  const renderCharts = () => {
    const palette = getChartPalette();
    
    // Trend Chart
    const trendGroup = groupBy(state.filteredData, (item) => item.dateKey);
    const sortedTrend = [...trendGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const trendLabels = sortedTrend.map(([key]) => formatDateId(new Date(`${key}T00:00:00`)));
    const trendValues = sortedTrend.map(([, items]) => items.length);
    
    updateOrCreateChart('trendChart', 'line', trendLabels, [{
      label: 'Jumlah Kendala',
      data: trendValues,
      borderColor: '#38bdf8',
      backgroundColor: 'rgba(56, 189, 248, 0.15)',
      fill: true,
      tension: 0.3,
      pointRadius: 3
    }], { scales: baseScales(palette), plugins: basePlugins(palette) });

    // Leader Chart
    const topLeader = getTopCounts(state.filteredData, 'leader', 10);
    updateOrCreateChart('leaderChart', 'bar', topLeader.labels, [{
      label: 'Jumlah Kendala',
      data: topLeader.values,
      backgroundColor: palette.series
    }], { indexAxis: 'y', scales: baseScales(palette), plugins: basePlugins(palette) });

    // Kendala Chart
    const topKendala = getTopCounts(state.filteredData, 'kendala', 10);
    updateOrCreateChart('kendalaChart', 'doughnut', topKendala.labels, [{
      data: topKendala.values,
      backgroundColor: palette.series,
      borderColor: palette.background,
      borderWidth: 2
    }], { plugins: basePlugins(palette) });

    // Status Chart
    const statusCounts = ['Pending', 'On Progress', 'Done'].map((st) => state.filteredData.filter((item) => item.status === st).length);
    updateOrCreateChart('statusChart', 'pie', ['Pending', 'On Progress', 'Done'], [{
      data: statusCounts,
      backgroundColor: ['#f59e0b', '#3b82f6', '#22c55e'],
      borderColor: palette.background,
      borderWidth: 2
    }], { plugins: basePlugins(palette) });
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
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...extraOptions
        }
      });
    }
  };

  const getChartPalette = () => {
    const theme = document.documentElement.getAttribute('data-bs-theme');
    return {
      text: theme === 'dark' ? '#e2e8f0' : '#0f172a',
      grid: theme === 'dark' ? 'rgba(148, 163, 184, 0.1)' : 'rgba(148, 163, 184, 0.15)',
      background: theme === 'dark' ? '#121c31' : '#ffffff',
      series: ['#38bdf8', '#6366f1', '#14b8a6', '#ec4899', '#f59e0b', '#22c55e', '#8b5cf6', '#ef4444', '#0ea5e9', '#eab308']
    };
  };

  const basePlugins = (palette) => ({
    legend: { labels: { color: palette.text, boxWidth: 12, font: { family: 'Inter' } } },
    tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 12 }
  });

  const baseScales = (palette) => ({
    x: { ticks: { color: palette.text, font: { family: 'Inter' } }, grid: { color: palette.grid } },
    y: { ticks: { color: palette.text, font: { family: 'Inter' } }, grid: { color: palette.grid } }
  });

  const groupBy = (array, keyGetter) => array.reduce((map, item) => {
    const key = keyGetter(item);
    const collection = map.get(key) || [];
    collection.push(item);
    map.set(key, collection);
    return map;
  }, new Map());

  const getTopCounts = (data, field, limit) => {
    const counter = data.reduce((acc, item) => {
      const key = item[field] || 'Tidak ditemukan';
      acc.set(key, (acc.get(key) || 0) + 1);
      return acc;
    }, new Map());
    const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    return { labels: sorted.map(([l]) => l), values: sorted.map(([, v]) => v) };
  };

  const initializeDataTable = () => {
    state.dataTable = $('#kendalaTable').DataTable({
      data: [],
      columns: [
        { data: 'tanggal', render: (data, type, row) => type === 'sort' ? row.dateTimestamp : data },
        { data: 'tid' },
        { data: 'merchant' },
        { data: 'leader' },
        { data: 'kendala' },
        { data: 'sm', render: renderProcessPill('SM', 'pill-sm') },
        { data: 'cm', render: renderProcessPill('CM', 'pill-cm') },
        { data: 'fu', render: renderProcessPill('FU', 'pill-fu') },
        { data: 'status', render: renderStatusBadge },
        { data: 'note' }
      ],
      dom: 'Bfrt<"row mt-3 align-items-center"<"col-md-6"i><"col-md-6"p>>',
      buttons: [
        { extend: 'excelHtml5', text: '<i class="bi bi-file-earmark-excel me-2"></i>Excel', className: 'btn btn-sm btn-outline-secondary' },
        { extend: 'csvHtml5', text: '<i class="bi bi-filetype-csv me-2"></i>CSV', className: 'btn btn-sm btn-outline-secondary' }
      ],
      pageLength: 10,
      order: [[0, 'desc']],
      responsive: true,
      language: {
        emptyTable: 'Belum ada data untuk ditampilkan',
        info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ data',
        infoEmpty: 'Menampilkan 0 data',
        search: 'Cari langsung:',
        paginate: { previous: '<i class="bi bi-chevron-left"></i>', next: '<i class="bi bi-chevron-right"></i>' }
      }
    });
  };

  const renderProcessPill = (label, className) => (value) => value
    ? `<span class="process-pill ${className}">${label}</span>`
    : '<span class="process-pill pill-off">-</span>';

  const renderStatusBadge = (status) => {
    const className = status === 'Pending' ? 'pending' : status === 'On Progress' ? 'progress' : 'done';
    return `<span class="badge-soft ${className}">${status}</span>`;
  };

  const updateTable = () => {
    if (!state.dataTable) return;
    state.dataTable.clear().rows.add(state.filteredData).draw();
  };

  const updateLastUpdated = () => {
    if (!state.lastUpdated) return;
    const formatted = formatDateTimeId(state.lastUpdated);
    elements.lastUpdateLabel.textContent = `Live: ${formatted.split(' ')[3]}`;
    elements.lastUpdateFull.textContent = formatted;
  };

  const updateRecordCount = () => {
    elements.recordCountLabel.textContent = `${state.filteredData.length.toLocaleString('id-ID')} berkas ditemukan`;
  };

  const showError = (message) => {
    if (!message) {
      elements.errorAlert.classList.add('d-none');
      return;
    }
    elements.errorAlert.textContent = message;
    elements.errorAlert.classList.remove('d-none');
  };

  const setLoading = (isLoading) => {
    elements.loadingOverlay.classList.toggle('d-none', !isLoading);
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', DashboardApp.init);