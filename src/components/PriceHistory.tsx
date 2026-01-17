'use client';

import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { usePriceHistory, ChartDataPoint } from '@/hooks/usePriceHistory';
import { toast } from 'sonner';

// Currency types: 0 = 金幣 (Gold), 1 = 魔晶 (Crystal)
const CURRENCY_NAMES: Record<number, string> = {
  0: '金幣',
  1: '魔晶',
};

// Default exchange rate: 1 魔晶 = 333 金幣
const DEFAULT_CRYSTAL_RATE = 333;
const RATE_STORAGE_KEY = 'market-tracker-crystal-rate';

// Get exchange rate from localStorage
function getExchangeRate(): number {
  if (typeof window === 'undefined') return DEFAULT_CRYSTAL_RATE;
  const stored = localStorage.getItem(RATE_STORAGE_KEY);
  if (stored) {
    const rate = parseFloat(stored);
    if (!isNaN(rate) && rate > 0) return rate;
  }
  return DEFAULT_CRYSTAL_RATE;
}

// Format large numbers with K suffix
function formatPrice(price: number | undefined): string {
  if (price === undefined || price === null) return '0';
  if (price >= 1000000) {
    return (price / 1000000).toFixed(1) + 'M';
  }
  if (price >= 1000) {
    return (price / 1000).toFixed(1) + 'K';
  }
  return price.toString();
}

// Format with currency
function formatPriceWithCurrency(price: number, priceType: number): string {
  const formatted = formatPrice(price);
  const currency = CURRENCY_NAMES[priceType] || '金幣';
  return `${formatted} ${currency}`;
}

// Format timestamp for display
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-TW', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Format for chart axis
function formatChartTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Convert price to gold equivalent
function normalizeToGold(price: number, priceType: number, rate: number): number {
  if (priceType === 1) {
    return price * rate;
  }
  return price;
}

// Chart colors for different items - vibrant and distinct
const CHART_COLORS = [
  '#6366f1', // indigo
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
];

export function PriceHistory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [type, setType] = useState<string>('all');
  const { logs, loading, error, search, progress, stats, chartData } = usePriceHistory();
  const [crystalRate, setCrystalRate] = useState(DEFAULT_CRYSTAL_RATE);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Load exchange rate from localStorage on mount
  useEffect(() => {
    setCrystalRate(getExchangeRate());
  }, []);

  // Get unique item names from logs
  const uniqueItems = useMemo(() => {
    const names = new Set<string>();
    logs.forEach(log => names.add(log.name));
    return Array.from(names).sort();
  }, [logs]);

  // Reset selected items when new search results come in
  useEffect(() => {
    if (uniqueItems.length > 0) {
      setSelectedItems(new Set(uniqueItems));
    }
  }, [uniqueItems]);

  // Get color for an item based on its index
  const getItemColor = (name: string) => {
    const index = uniqueItems.indexOf(name);
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  // Transform chart data: normalize UNIT prices to gold and group by timestamp for multi-line chart
  const transformedChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    // Filter by selected items first
    const filtered = selectedItems.size === 0
      ? chartData
      : chartData.filter(point => selectedItems.has(point.name));

    // Sort by timestamp
    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);

    // Create data points with normalized gold unit prices
    // Each point has timestamp and a price field for each item
    const dataByTimestamp = new Map<number, Record<string, number | string>>();

    sorted.forEach(point => {
      // Use unitPrice for chart (price per single item)
      const goldUnitPrice = normalizeToGold(point.unitPrice, point.priceType, crystalRate);
      const key = point.timestamp;

      if (!dataByTimestamp.has(key)) {
        dataByTimestamp.set(key, { timestamp: key });
      }

      const entry = dataByTimestamp.get(key)!;
      // Use item name as key for the unit price
      entry[point.name] = goldUnitPrice;
    });

    return Array.from(dataByTimestamp.values());
  }, [chartData, selectedItems, crystalRate]);

  // Calculate stats for filtered items (in gold, using unit price)
  const filteredStats = useMemo(() => {
    if (chartData.length === 0) return null;

    const filtered = selectedItems.size === 0
      ? chartData
      : chartData.filter(point => selectedItems.has(point.name));

    if (filtered.length === 0) return null;

    // Use unitPrice for stats
    const goldUnitPrices = filtered.map(d => normalizeToGold(d.unitPrice, d.priceType, crystalRate));
    return {
      min: Math.min(...goldUnitPrices),
      max: Math.max(...goldUnitPrices),
      avg: goldUnitPrices.reduce((sum, p) => sum + p, 0) / goldUnitPrices.length,
      count: filtered.length,
    };
  }, [chartData, selectedItems, crystalRate]);

  // Get selected items for rendering lines
  const selectedItemsList = useMemo(() => {
    return uniqueItems.filter(name => selectedItems.has(name));
  }, [uniqueItems, selectedItems]);

  const toggleItem = (name: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedItems(new Set(uniqueItems));
  const selectNone = () => setSelectedItems(new Set());

  const handleSearch = async () => {
    if (!searchTerm.trim()) {
      toast.error('Please enter a search term');
      return;
    }

    const result = await search({
      search: searchTerm,
      type: type as 'all' | 'item' | 'pet',
    });

    if (result) {
      toast.success(`Found ${result.length} price records`);
    }
  };

  // Calculate gold-equivalent price for display
  const getGoldEquivalent = (price: number, priceType: number): string => {
    if (priceType === 1) {
      const goldEquiv = price * crystalRate;
      return `(~${formatPrice(goldEquiv)} 金)`;
    }
    return '';
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Input
              placeholder="Search item name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 min-w-[200px]"
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="item">Items</SelectItem>
                <SelectItem value="pet">Pets</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? 'Searching...' : 'Search'}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Shows up to 100 most recent transactions (last 24 hours)
          </p>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-500">
          <CardContent className="pt-4">
            <p className="text-red-500">Error: {error}</p>
          </CardContent>
        </Card>
      )}

      {progress && (
        <Card>
          <CardContent className="pt-4">
            <Badge variant="outline" className="text-sm">
              Loading page {progress.current}/{progress.total}...
            </Badge>
          </CardContent>
        </Card>
      )}


      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Price Chart
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  (in 金幣)
                </span>
              </CardTitle>
              {uniqueItems.length > 1 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectNone}>
                    Clear
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Item filter checkboxes */}
            {uniqueItems.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                {uniqueItems.map((name) => {
                  const color = getItemColor(name);
                  const isSelected = selectedItems.has(name);
                  return (
                    <label
                      key={name}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-white dark:bg-zinc-800 shadow-sm'
                          : 'opacity-50 hover:opacity-75'
                      }`}
                      style={{
                        borderLeft: `4px solid ${color}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItem(name)}
                        className="rounded accent-current"
                        style={{ accentColor: color }}
                      />
                      <span
                        className="text-sm font-medium"
                        style={{ color: isSelected ? color : undefined }}
                      >
                        {name}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            {/* Stats for filtered items */}
            {filteredStats && (
              <div className="flex flex-wrap gap-3 mb-4 p-3 bg-gradient-to-r from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Records:</span>
                  <span className="font-semibold">{filteredStats.count}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Min:</span>
                  <span className="font-semibold text-green-600">{formatPrice(filteredStats.min)} 金</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Avg:</span>
                  <span className="font-semibold">{formatPrice(Math.round(filteredStats.avg))} 金</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Max:</span>
                  <span className="font-semibold text-red-600">{formatPrice(filteredStats.max)} 金</span>
                </div>
              </div>
            )}

            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={transformedChartData}
                  margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={formatChartTime}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={{ stroke: '#d1d5db' }}
                    tickLine={{ stroke: '#d1d5db' }}
                  />
                  <YAxis
                    tickFormatter={(value) => formatPrice(value) + ' 金'}
                    tick={{ fontSize: 11, fill: '#6b7280' }}
                    axisLine={{ stroke: '#d1d5db' }}
                    tickLine={{ stroke: '#d1d5db' }}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    labelFormatter={(value) => formatChartTime(value as number)}
                    formatter={(value, name) => [
                      `${formatPrice(value as number)} 金幣`,
                      name,
                    ]}
                  />
                  {filteredStats && (
                    <ReferenceLine
                      y={filteredStats.avg}
                      stroke="#9ca3af"
                      strokeDasharray="8 4"
                      strokeWidth={2}
                      label={{
                        value: `Avg: ${formatPrice(filteredStats.avg)} 金`,
                        position: 'right',
                        fontSize: 11,
                        fill: '#6b7280',
                      }}
                    />
                  )}
                  {selectedItemsList.map((name) => (
                    <Line
                      key={name}
                      type="monotone"
                      dataKey={name}
                      name={name}
                      stroke={getItemColor(name)}
                      strokeWidth={3}
                      dot={{ r: 4, fill: getItemColor(name), strokeWidth: 2, stroke: '#fff' }}
                      activeDot={{ r: 6, fill: getItemColor(name), strokeWidth: 2, stroke: '#fff' }}
                      connectNulls
                    />
                  ))}
                  {selectedItemsList.length > 1 && (
                    <Legend
                      wrapperStyle={{ paddingTop: '10px' }}
                      formatter={(value) => (
                        <span style={{ color: getItemColor(value), fontWeight: 500 }}>
                          {value}
                        </span>
                      )}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Transaction History ({logs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead>Unit Price</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.slice(0, 50).map((log) => {
                  const isSelected = selectedItems.has(log.name);
                  const itemColor = getItemColor(log.name);
                  return (
                  <TableRow
                    key={log.id}
                    className={isSelected ? 'bg-zinc-50 dark:bg-zinc-900' : 'opacity-50'}
                    style={isSelected ? { borderLeft: `3px solid ${itemColor}` } : undefined}
                  >
                    <TableCell className="font-medium">
                      <span style={isSelected ? { color: itemColor } : undefined}>
                        {log.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {log.quantity > 1 ? (
                        <Badge variant="secondary">{log.quantity}</Badge>
                      ) : (
                        <span className="text-muted-foreground">1</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold">
                        {formatPriceWithCurrency(log.unitPrice ?? log.price, log.pricetype)}
                      </span>
                      {log.pricetype === 1 && (
                        <span className="text-muted-foreground text-xs ml-1">
                          {getGoldEquivalent(log.unitPrice ?? log.price, log.pricetype)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {log.quantity > 1 ? (
                        <>
                          {formatPriceWithCurrency(log.price, log.pricetype)}
                          {log.pricetype === 1 && (
                            <span className="text-xs ml-1">
                              {getGoldEquivalent(log.price, log.pricetype)}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={log.type === 'pet' ? 'outline' : 'secondary'} className={log.type === 'pet' ? 'text-purple-600' : ''}>
                        {log.type === 'pet' ? 'Pet' : 'Item'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatTime(log.time)}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {logs.length > 50 && (
              <p className="text-sm text-muted-foreground mt-4">
                Showing first 50 of {logs.length} records
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
