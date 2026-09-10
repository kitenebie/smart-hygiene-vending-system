import { useState } from 'react';
import { usePolling } from '../hooks/usePolling';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { supabase } from '../utils/supabase';
import { slotStatus, timeAgo, levelMeta } from '../utils/helpers';
import StatCard from '../components/StatCard';
import SlotTag from '../components/SlotTag';
import { useToast } from '../components/Toast';

interface SlotData {
  id: number;
  slot_code: string;
  product_name: string;
  stock: number;
  capacity: number;
  status: 'ok' | 'low' | 'empty';
}

interface OverviewData {
  units_left: number;
  units_capacity: number;
  today_sales: number;
  sales_delta_pct: number | null;
  dispenses_today: number;
  gcash_count: number;
  coin_count: number;
  coin_box_pct: number;
  low_stock_slots: { slot_code: string; product_name: string; stock: number; status: 'low' | 'empty' }[];
  activity: { type: string; text: string; time: string; time_label: string; level: 'info' | 'warning' | 'critical' }[];
  last_sync: string | null;

  // Chart data
  trendDates: string[];
  trendSales: number[];
  trendGcash: number[];
  trendCoin: number[];

  productLabels: string[];
  productDispenses: number[];
  productStocks: number[];

  paymentLabels: string[];
  paymentCounts: number[];
  paymentAmounts: number[];

  stockDistributionLabels: string[];
  stockDistributionValues: number[];
}

interface OverviewViewProps {
  onSyncChange: (v: string | null) => void;
}

export default function OverviewView({ onSyncChange }: OverviewViewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const { showToast } = useToast();

  usePolling(load);

  async function load() {
    try {
      // 1. Settings
      const { data: settings } = await supabase
        .from('machine_settings')
        .select('low_stock_threshold')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      const threshold = settings?.low_stock_threshold ?? 5;

      // 2. Slots
      const { data: rawSlots } = await supabase
        .from('slots')
        .select('*')
        .order('slot_code');
      
      const slots: SlotData[] = (rawSlots ?? []).map(s => ({
        ...s,
        status: slotStatus(s.stock, threshold),
      }));

      const totalStock = slots.reduce((s, r) => s + r.stock, 0);
      const totalCap = slots.reduce((s, r) => s + r.capacity, 0);
      const lowStockSlots = slots
        .filter(s => s.status !== 'ok')
        .map(s => ({
          slot_code: s.slot_code,
          product_name: s.product_name,
          stock: s.stock,
          status: s.status as 'low' | 'empty',
        }));

      // 3. All Transactions for Trend & Analytics
      const { data: allTx } = await supabase
        .from('transactions')
        .select('*, slots(slot_code, product_name)')
        .order('created_at', { ascending: true });

      const txList = allTx ?? [];

      // Today's Date Strings
      const todayStr = new Date().toISOString().slice(0, 10);
      const yestStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

      const txToday = txList.filter(t => t.created_at && t.created_at.slice(0, 10) === todayStr);
      const txYest = txList.filter(t => t.created_at && t.created_at.slice(0, 10) === yestStr);

      const todayTotal = txToday.reduce((s, r) => s + Number(r.amount), 0);
      const yestTotal = txYest.reduce((s, r) => s + Number(r.amount), 0);
      const gcashCountToday = txToday.filter(r => r.method === 'gcash').length;
      const coinCountToday = txToday.filter(r => r.method === 'coin').length;

      const salesDelta = yestTotal > 0 ? Math.round(((todayTotal - yestTotal) / yestTotal) * 100) : null;

      // 4. Device Health
      const { data: health } = await supabase
        .from('device_health')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const coinBoxPct = health && health.coin_box_capacity_pulses > 0
        ? Math.round((health.coin_box_pulses_total / health.coin_box_capacity_pulses) * 100)
        : 0;

      // 5. Recent Activity
      const { data: recentLogs } = await supabase
        .from('machine_health_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      const recentTx = [...txList].reverse().slice(0, 5);

      const activity: OverviewData['activity'] = [
        ...recentTx.map(t => ({
          type: 'tx',
          text: `${t.method === 'gcash' ? 'GCash' : 'Coin'} payment of ₱${Number(t.amount).toFixed(2)} — ${(t.slots as { slot_code: string; product_name: string } | null)?.slot_code ?? ''} (${(t.slots as { slot_code: string; product_name: string } | null)?.product_name ?? ''})`,
          time: t.created_at,
          time_label: timeAgo(t.created_at),
          level: 'info' as const,
        })),
        ...(recentLogs ?? []).map(l => ({
          type: 'log',
          text: l.message,
          time: l.created_at,
          time_label: timeAgo(l.created_at),
          level: l.level as 'info' | 'warning' | 'critical',
        })),
      ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 6);

      onSyncChange(health?.last_sync ?? null);

      // ─────────────────────────────────────────────────────────────
      // 6. Analytics Data Aggregation for ApexCharts
      // ─────────────────────────────────────────────────────────────

      // Group Transactions by Date for Multi-Line Trend Chart
      const dailyMap: Record<string, { dateLabel: string; sales: number; gcash: number; coin: number }> = {};

      // Seed past 7 days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const isoKey = d.toISOString().slice(0, 10);
        const dateLabel = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dailyMap[isoKey] = { dateLabel, sales: 0, gcash: 0, coin: 0 };
      }

      txList.forEach(t => {
        if (!t.created_at) return;
        const key = t.created_at.slice(0, 10);
        if (!dailyMap[key]) {
          const d = new Date(t.created_at);
          dailyMap[key] = {
            dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            sales: 0,
            gcash: 0,
            coin: 0,
          };
        }
        dailyMap[key].sales += Number(t.amount);
        if (t.method === 'gcash') dailyMap[key].gcash += 1;
        else dailyMap[key].coin += 1;
      });

      const sortedDates = Object.keys(dailyMap).sort().slice(-7);
      const trendDates = sortedDates.map(k => dailyMap[k].dateLabel);
      const trendSales = sortedDates.map(k => dailyMap[k].sales);
      const trendGcash = sortedDates.map(k => dailyMap[k].gcash);
      const trendCoin = sortedDates.map(k => dailyMap[k].coin);

      // Product Demand vs Remaining Stock for Bar Chart
      const slotDispensesMap: Record<number, number> = {};
      txList.forEach(t => {
        if (t.slot_id) {
          slotDispensesMap[t.slot_id] = (slotDispensesMap[t.slot_id] || 0) + 1;
        }
      });

      const productLabels = slots.map(s => `${s.slot_code}: ${s.product_name.split('—')[0].trim()}`);
      const productDispenses = slots.map(s => slotDispensesMap[s.id] || 0);
      const productStocks = slots.map(s => s.stock);

      // Payment Distribution for Pie / Donut Chart
      const totalGcashCount = txList.filter(t => t.method === 'gcash').length;
      const totalCoinCount = txList.filter(t => t.method === 'coin').length;
      const totalGcashAmount = txList.filter(t => t.method === 'gcash').reduce((s, r) => s + Number(r.amount), 0);
      const totalCoinAmount = txList.filter(t => t.method === 'coin').reduce((s, r) => s + Number(r.amount), 0);

      const paymentLabels = ['GCash Online', 'Coin Acceptor'];
      const paymentCounts = [totalGcashCount || 1, totalCoinCount || 1];
      const paymentAmounts = [totalGcashAmount, totalCoinAmount];

      // Stock Allocation
      const stockDistributionLabels = slots.map(s => `${s.slot_code} (${s.product_name.slice(0, 14)}…)`);
      const stockDistributionValues = slots.map(s => s.stock);

      setData({
        units_left: totalStock,
        units_capacity: totalCap,
        today_sales: todayTotal,
        sales_delta_pct: salesDelta,
        dispenses_today: txToday.length,
        gcash_count: gcashCountToday,
        coin_count: coinCountToday,
        coin_box_pct: coinBoxPct,
        low_stock_slots: lowStockSlots,
        activity,
        last_sync: health?.last_sync ?? null,

        trendDates,
        trendSales,
        trendGcash,
        trendCoin,

        productLabels,
        productDispenses,
        productStocks,

        paymentLabels,
        paymentCounts,
        paymentAmounts,

        stockDistributionLabels,
        stockDistributionValues,
      });
    } catch {
      showToast('Could not load overview.', true);
    }
  }

  if (!data) {
    return (
      <div>
        <div className="stat-row">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="stat-card skeleton" />
          ))}
        </div>
      </div>
    );
  }

  const deltaLabel =
    data.sales_delta_pct === null
      ? 'No data yesterday'
      : (data.sales_delta_pct >= 0 ? '↑ ' : '↓ ') + Math.abs(data.sales_delta_pct) + '% vs yesterday';

  // ─────────────────────────────────────────────────────────────
  // ApexCharts Configs & Themes
  // ─────────────────────────────────────────────────────────────

  // 1. Multi-Line & Area Trend Chart
  const multiLineOptions: ApexOptions = {
    chart: {
      type: 'area',
      background: 'transparent',
      foreColor: '#9b939e',
      fontFamily: "'Work Sans', sans-serif",
      toolbar: { show: false },
      zoom: { enabled: false },
    },
    colors: ['#d97b93', '#0072de', '#8fb389'],
    stroke: {
      curve: 'smooth',
      width: [3, 2, 2],
    },
    fill: {
      type: ['gradient', 'solid', 'solid'],
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [0, 90, 100],
      },
    },
    dataLabels: { enabled: false },
    grid: {
      borderColor: '#252229',
      strokeDashArray: 3,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
    },
    xaxis: {
      categories: data.trendDates,
      axisBorder: { color: '#252229' },
      axisTicks: { color: '#252229' },
      labels: {
        style: {
          fontSize: '11px',
          fontFamily: "'JetBrains Mono', monospace",
        },
      },
    },
    yaxis: [
      {
        title: {
          text: 'Revenue (₱)',
          style: { color: '#d97b93', fontSize: '11px', fontWeight: 600 },
        },
        labels: {
          formatter: v => `₱${Number(v).toFixed(0)}`,
          style: { fontFamily: "'JetBrains Mono', monospace" },
        },
      },
      {
        opposite: true,
        title: {
          text: 'Dispenses (Count)',
          style: { color: '#9b939e', fontSize: '11px', fontWeight: 600 },
        },
        labels: {
          formatter: v => Number(v).toFixed(0),
          style: { fontFamily: "'JetBrains Mono', monospace" },
        },
      },
    ],
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#f1ece6' },
      markers: { size: 6, strokeWidth: 0 },
    },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
      y: {
        formatter: (v: number, opts?: any) =>
          opts?.seriesIndex === 0 ? `₱${Number(v).toFixed(2)}` : `${v} units`,
      },
    },
  };

  const multiLineSeries = [
    { name: 'Total Revenue (₱)', type: 'area', data: data.trendSales },
    { name: 'GCash Dispenses', type: 'line', data: data.trendGcash },
    { name: 'Coin Dispenses', type: 'line', data: data.trendCoin },
  ];

  // 2. Bar Chart (Product Demand & Stock Levels)
  const barChartOptions: ApexOptions = {
    chart: {
      type: 'bar',
      background: 'transparent',
      foreColor: '#9b939e',
      fontFamily: "'Work Sans', sans-serif",
      toolbar: { show: false },
    },
    colors: ['#d97b93', '#8fb389'],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '46%',
        borderRadius: 4,
      },
    },
    dataLabels: { enabled: false },
    grid: {
      borderColor: '#252229',
      strokeDashArray: 3,
    },
    xaxis: {
      categories: data.productLabels,
      axisBorder: { color: '#252229' },
      labels: {
        style: {
          fontSize: '10.5px',
          fontFamily: "'Work Sans', sans-serif",
        },
      },
    },
    yaxis: {
      title: {
        text: 'Units / Volume',
        style: { color: '#9b939e', fontSize: '11px' },
      },
      labels: {
        style: { fontFamily: "'JetBrains Mono', monospace" },
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: { colors: '#f1ece6' },
      markers: { size: 6, strokeWidth: 0 },
    },
    tooltip: {
      theme: 'dark',
      style: { fontSize: '12px' },
    },
  };

  const barChartSeries = [
    { name: 'Total Dispensed', data: data.productDispenses },
    { name: 'Remaining Stock', data: data.productStocks },
  ];

  // 3. Donut / Pie Chart (Payment Methods Share)
  const pieChartOptions: ApexOptions = {
    chart: {
      type: 'donut',
      background: 'transparent',
      fontFamily: "'Work Sans', sans-serif",
    },
    colors: ['#0072de', '#d97b93'],
    labels: data.paymentLabels,
    stroke: {
      colors: ['#151318'],
      width: 2,
    },
    dataLabels: {
      enabled: true,
      formatter: val => `${Number(val).toFixed(0)}%`,
      style: {
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', monospace",
      },
    },
    legend: {
      position: 'bottom',
      labels: { colors: '#f1ece6' },
      markers: { size: 6, strokeWidth: 0 },
    },
    plotOptions: {
      pie: {
        donut: {
          size: '68%',
          labels: {
            show: true,
            total: {
              show: true,
              label: 'Total Dispenses',
              color: '#9b939e',
              fontSize: '11px',
              fontFamily: "'Work Sans', sans-serif",
              formatter: () => `${data.paymentCounts.reduce((a, b) => a + b, 0)}`,
            },
            value: {
              color: '#f1ece6',
              fontSize: '22px',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
            },
          },
        },
      },
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: (val: number, opts?: any) =>
          `${val} transactions (₱${(data.paymentAmounts[opts?.seriesIndex ?? 0] || 0).toFixed(2)})`,
      },
    },
  };

  // 4. Stock Distribution Pie Chart
  const stockPieOptions: ApexOptions = {
    chart: {
      type: 'pie',
      background: 'transparent',
      fontFamily: "'Work Sans', sans-serif",
    },
    colors: ['#d97b93', '#8fb389', '#e0ab4c', '#0072de', '#e0715a'],
    labels: data.stockDistributionLabels,
    stroke: {
      colors: ['#151318'],
      width: 2,
    },
    dataLabels: {
      enabled: true,
      formatter: val => `${Number(val).toFixed(0)}%`,
      style: {
        fontSize: '10.5px',
        fontFamily: "'JetBrains Mono', monospace",
      },
    },
    legend: {
      position: 'bottom',
      labels: { colors: '#f1ece6' },
      markers: { size: 5, strokeWidth: 0 },
    },
    tooltip: {
      theme: 'dark',
      y: {
        formatter: val => `${val} units in rack`,
      },
    },
  };

  return (
    <div>
      {/* Stat KPI Cards */}
      <div className="stat-row">
        <StatCard label="Units left" value={data.units_left} delta={`of ${data.units_capacity} capacity`} />
        <StatCard
          label="Today's sales"
          value={`₱${data.today_sales.toFixed(0)}`}
          delta={deltaLabel}
          deltaDown={(data.sales_delta_pct ?? 0) < 0}
        />
        <StatCard
          label="Dispenses today"
          value={data.dispenses_today}
          delta={`GCash ${data.gcash_count} · Coin ${data.coin_count}`}
        />
        <StatCard
          label="Coin box level"
          value={`${data.coin_box_pct}%`}
          delta={data.coin_box_pct >= 80 ? 'Nearing capacity' : 'Within normal range'}
          deltaDown={data.coin_box_pct >= 80}
        />
      </div>

      {/* ── 1. ApexChart: Multi-Series Revenue & Dispense Trends (Line/Area) ── */}
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title display">Revenue &amp; Dispense Trends</div>
            <div className="panel-title-sub">Multi-metric daily trajectory: Total Revenue (₱) vs GCash &amp; Coin Volume</div>
          </div>
        </div>
        <div className="chart-body">
          <Chart options={multiLineOptions} series={multiLineSeries} type="area" height={280} />
        </div>
      </div>

      {/* ── 2. ApexCharts: Bar Chart (Product Demand) & Pie Chart (Payment Share) ── */}
      <div className="charts-grid-2">
        {/* Bar Chart */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title display">Product Demand vs Stock</div>
              <div className="panel-title-sub">Total dispenses compared against remaining units per slot</div>
            </div>
          </div>
          <div className="chart-body">
            <Chart options={barChartOptions} series={barChartSeries} type="bar" height={260} />
          </div>
        </div>

        {/* Donut Chart */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title display">Payment Method Share</div>
              <div className="panel-title-sub">Transaction volume split between GCash and Cash Coins</div>
            </div>
          </div>
          <div className="chart-body">
            <Chart options={pieChartOptions} series={data.paymentCounts} type="donut" height={260} />
          </div>
        </div>
      </div>

      {/* ── 3. ApexChart: Inventory Stock Allocation (Pie) & Attention Needed ── */}
      <div className="charts-grid-2">
        {/* Stock Pie Chart */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title display">Current Inventory Allocation</div>
              <div className="panel-title-sub">Proportional stock distribution across physical slots</div>
            </div>
          </div>
          <div className="chart-body">
            <Chart options={stockPieOptions} series={data.stockDistributionValues} type="pie" height={240} />
          </div>
        </div>

        {/* Attention needed table */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title display">Attention needed</div>
              <div className="panel-title-sub">Slots that are low or empty right now</div>
            </div>
          </div>
          <table className="slot-table">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Product</th>
                <th>Stock</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.low_stock_slots.length ? (
                data.low_stock_slots.map(s => (
                  <tr key={s.slot_code}>
                    <td className="slot-id">{s.slot_code}</td>
                    <td>{s.product_name}</td>
                    <td className="mono">{s.stock}</td>
                    <td>
                      <SlotTag status={s.status} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="empty-note">
                    Nothing needs attention — every slot is stocked.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 4. Recent Activity Feed ── */}
      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title display">Recent activity</div>
            <div className="panel-title-sub">Latest transactions and machine alerts</div>
          </div>
        </div>
        <div className="log-list">
          {data.activity.length ? (
            data.activity.map((a, i) => {
              const meta = levelMeta[a.level] ?? levelMeta.info;
              return (
                <div className="log-row" key={i}>
                  <div className="log-icon" style={{ background: meta.bg, color: meta.color }}>
                    {meta.icon}
                  </div>
                  <div>
                    <div className="log-text">{a.text}</div>
                    <div className="log-time">{a.time_label}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-note">No activity yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
