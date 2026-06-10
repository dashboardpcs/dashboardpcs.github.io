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
      'kpiTotalToday', 'kpiPending', 'kpiProgress', 'kpiDone', 'kpiSM', 'kpiCM', 'kpiFU'
    ];

    ids.forEach((id) => {
      elements[id] = document.getElementById(id);
    });
  };

  const bindEvents = () => {
    elements.refreshButton.addEventListener('click', loadData);
    elements.themeToggle.addEventListener('click', toggleTheme);
    elements.sidebarToggle.addEventListener('click', () => elements.sidebar.classList.toggle('show'));

    ['startDate', 'endDate', 'leaderFilter', 'statusFilter', 'processFilter'].forEach((key) => {
      elements[key].addEventListener('change', handleFilterChange);
    });

    elements.merchantSearch.addEventListener('input', handleFilterChange);
    elements.resetFilters.addEventListener('click', resetFilters);

    document.querySelectorAll('.sidebar-link').forEach((link) => {
      link.addEventListener('click', () => {
        document.querySelectorAll('.sidebar-link').forEach((item) => item.classList.remove('active'));
        link.classList.add('active');
        elements.sidebar.classList.remove('show');
      });
    });
  };

  const toggleTheme = () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-bs-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-bs-theme', next);
    localStorage.setItem('dashboard-theme', next);
    updateThemeIcon(next);
    refreshCharts();
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

      if (!response.ok) {
        throw new Error(`Gagal mengambil data. HTTP ${response.status}`);
      }

      const csvText = await response.text();
      const parsed = parseCsv(csvText).map(mapRow).filter((item) => item && item.dateObj instanceof Date && !Number.isNaN(item.dateObj.getTime()));

      state.rawData = parsed.sort((a, b) => b.dateObj - a.dateObj);
      state.lastUpdated = new Date();

      populateLeaderFilter();
      applyFilters();
      updateLastUpdated();
    } catch (error) {
      console.error(error);
      showError(`Tidak dapat mengakses Google Sheet saat ini. ${error.message}. Silakan coba beberapa saat lagi.`);
      state.rawData = [];
      applyFilters();
    } finally {
      setLoading(false);
    }
  };

  const parseCsv = (csvText) => {
    const rows = [];
    let current = '';
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i += 1) {
      const char = csvText[i];
      const next = csvText[i + 1];

      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(current);
        if (row.some((cell) => cell.trim() !== '')) rows.push(row);
        row = [];
        current = '';
      } else {
        current += char;
      }
    }

    if (current.length > 0 || row.length > 0) {
      row.push(current);
      rows.push(row);
    }

    const [headers, ...dataRows] = rows;
    return dataRows.map((dataRow) => Object.fromEntries(headers.map((header, index) => [header.trim(), (dataRow[index] || '').trim()])));
  };

  const mapRow = (row) => {
    const rawDate = row['Tanggal'] || '';
    const dateObj = parseIndonesianDate(rawDate);
    const leader = normalizeEmpty(row['Leader']);
    const merchant = normalizeEmpty(row['Nama Merchant']);
    const status = normalizeStatus(row['Status tiket']);

    return {
      tanggal: rawDate,
      dateObj,
      dateKey: formatDateKey(dateObj),
      dateTimestamp: dateObj ? dateObj.getTime() : 0,
      tid: normalizeEmpty(row.TID),
      merchant,
      leader,
      kendala: normalizeEmpty(row.Kendala),
      sm: parseBooleanCell(row.SM),
      cm: parseBooleanCell(row.CM),
      fu: parseBooleanCell(row.FU),
      status,
      note: normalizeEmpty(row.Note),
      pelapor: normalizeEmpty(row.Pelapor)
    };
  };

  const normalizeEmpty = (value) => {
    const cleaned = String(value || '').trim();
    return cleaned || 'Tidak ditemukan';
  };

  const normalizeStatus = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'pending') return 'Pending';
    if (normalized === 'on progress') return 'On Progress';
    if (normalized === 'done') return 'Done';
    return 'Pending';
  };

  const parseBooleanCell = (value) => String(value || '').trim().toUpperCase() === 'TRUE';

  const parseIndonesianDate = (value) => {
    if (!value) return null;
    const [datePart, timePart = '00:00'] = value.split(' ');
    const [day, month, year] = datePart.split('/').map(Number);
    const [hour = 0, minute = 0] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute);
  };

  const formatDateKey = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateTimeId = (date) => new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);

  const formatDateId = (date) => new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
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
    const totalToday = data.filter((item) => item.dateKey === todayKey).length;

    elements.kpiTotalToday.textContent = totalToday;
    elements.kpiPending.textContent = data.filter((item) => item.status === 'Pending').length;
    elements.kpiProgress.textContent = data.filter((item) => item.status === 'On Progress').length;
    elements.kpiDone.textContent = data.filter((item) => item.status === 'Done').length;
    elements.kpiSM.textContent = data.filter((item) => item.sm).length;
    elements.kpiCM.textContent = data.filter((item) => item.cm).length;
    elements.kpiFU.textContent = data.filter((item) => item.fu).length;
  };

  const renderCharts = () => {
    const palette = getChartPalette();
    renderTrendChart(palette);
    renderLeaderChart(palette);
    renderKendalaChart(palette);
    renderStatusChart(palette);
  };

  const refreshCharts = () => {
    if (state.filteredData.length || state.rawData.length) {
      renderCharts();
    }
  };

  const renderTrendChart = (palette) => {
    const grouped = groupBy(state.filteredData, (item) => item.dateKey);
    const sortedEntries = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const labels = sortedEntries.map(([key]) => formatDateId(new Date(`${key}T00:00:00`)));
    const values = sortedEntries.map(([, items]) => items.length);

    createOrUpdateChart('trendChart', 'line', {
      labels,
      datasets: [{
        label: 'Jumlah Kendala',
        data: values,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.18)',
        fill: true,
        tension: 0.35,
        pointRadius: 4,
        pointHoverRadius: 6
      }]
    }, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: basePlugins(palette),
      scales: baseScales(palette)
    });
  };

  const renderLeaderChart = (palette) => {
    const top = getTopCounts(state.filteredData, 'leader', 10);
    createOrUpdateChart('leaderChart', 'bar', {
      labels: top.labels,
      datasets: [{
        label: 'Jumlah Kendala',
        data: top.values,
        backgroundColor: top.values.map((_, index) => palette.series[index % palette.series.length])
      }]
    }, {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: basePlugins(palette),
      scales: baseScales(palette)
    });
  };

  const renderKendalaChart = (palette) => {
    const top = getTopCounts(state.filteredData, 'kendala', 10);
    createOrUpdateChart('kendalaChart', 'doughnut', {
      labels: top.labels,
      datasets: [{
        data: top.values,
        backgroundColor: top.values.map((_, index) => palette.series[index % palette.series.length]),
        borderColor: palette.background,
        borderWidth: 2
      }]
    }, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: basePlugins(palette)
    });
  };

  const renderStatusChart = (palette) => {
    const counts = ['Pending', 'On Progress', 'Done'].map((status) => state.filteredData.filter((item) => item.status === status).length);
    createOrUpdateChart('statusChart', 'pie', {
      labels: ['Pending', 'On Progress', 'Done'],
      datasets: [{
        data: counts,
        backgroundColor: ['#f59e0b', '#3b82f6', '#22c55e'],
        borderColor: palette.background,
        borderWidth: 2
      }]
    }, {
      responsive: true,
      maintainAspectRatio: false,
      plugins: basePlugins(palette)
    });
  };

  const createOrUpdateChart = (canvasId, type, data, options) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (state.charts[canvasId]) {
      state.charts[canvasId].destroy();
    }

    state.charts[canvasId] = new Chart(canvas, { type, data, options });
  };

  const getChartPalette = () => {
    const theme = document.documentElement.getAttribute('data-bs-theme');
    return {
      text: theme === 'dark' ? '#e2e8f0' : '#0f172a',
      grid: theme === 'dark' ? 'rgba(148, 163, 184, 0.14)' : 'rgba(148, 163, 184, 0.24)',
      background: theme === 'dark' ? '#0f172a' : '#ffffff',
      series: ['#38bdf8', '#6366f1', '#14b8a6', '#ec4899', '#f59e0b', '#22c55e', '#8b5cf6', '#ef4444', '#0ea5e9', '#eab308']
    };
  };

  const basePlugins = (palette) => ({
    legend: {
      labels: {
        color: palette.text,
        usePointStyle: true
      }
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.92)',
      titleColor: '#fff',
      bodyColor: '#e2e8f0'
    }
  });

  const baseScales = (palette) => ({
    x: {
      ticks: { color: palette.text },
      grid: { color: palette.grid }
    },
    y: {
      ticks: { color: palette.text },
      grid: { color: palette.grid }
    }
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
    return {
      labels: sorted.map(([label]) => label),
      values: sorted.map(([, value]) => value)
    };
  };

  const initializeDataTable = () => {
    state.dataTable = $('#kendalaTable').DataTable({
      data: [],
      columns: [
        {
          data: 'tanggal',
          render: (data, type, row) => (type === 'sort' || type === 'type' ? row.dateTimestamp : data)
        },
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
        {
          extend: 'excelHtml5',
          text: '<i class="bi bi-file-earmark-excel me-2"></i>Export Excel',
          title: 'Monitoring Kendala Merchant EDC'
        },
        {
          extend: 'csvHtml5',
          text: '<i class="bi bi-filetype-csv me-2"></i>Export CSV',
          title: 'Monitoring Kendala Merchant EDC'
        }
      ],
      pageLength: 10,
      lengthMenu: [10, 25, 50, 100],
      order: [[0, 'desc']],
      responsive: true,
      language: {
        emptyTable: 'Belum ada data untuk ditampilkan',
        info: 'Menampilkan _START_ sampai _END_ dari _TOTAL_ data',
        infoEmpty: 'Menampilkan 0 sampai 0 dari 0 data',
        lengthMenu: 'Tampilkan _MENU_ data',
        search: 'Search tabel:',
        searchPlaceholder: 'Cari semua kolom...',
        paginate: { previous: 'Sebelumnya', next: 'Berikutnya' }
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
    state.dataTable.clear();
    state.dataTable.rows.add(state.filteredData);
    state.dataTable.draw();
  };

  const updateLastUpdated = () => {
    if (!state.lastUpdated) return;
    const formatted = formatDateTimeId(state.lastUpdated);
    elements.lastUpdateLabel.textContent = `Update: ${formatted}`;
    elements.lastUpdateFull.textContent = formatted;
  };

  const updateRecordCount = () => {
    elements.recordCountLabel.textContent = `${state.filteredData.length.toLocaleString('id-ID')} data ditampilkan`;
  };

  const showError = (message) => {
    if (!message) {
      elements.errorAlert.classList.add('d-none');
      elements.errorAlert.textContent = '';
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