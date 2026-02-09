"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PetData } from "@/data/pet-types";
import {
  RACES,
  CARD_TYPE_MAX_TOTAL,
  CARD_FULL_BONUS,
  CARD_TYPE_RATE,
  FIVE_STAT_LABELS,
  FIVE_STAT_SHORT,
  SCORE_WEIGHTS,
  SKILL_SLOT_WEIGHT,
} from "@/data/pet-types";
import {
  calculateStats,
  calculateStatsRaw,
  calculateScore,
  calculatePointInfo,
  reverseStatsToRandom,
  type CalcInput,
  type FinalStats,
  type RawStats,
} from "@/lib/pet-calc";
import petsData from "@/data/pets.json";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const allPets = petsData as PetData[];

const STORAGE_KEY = "pet-calc-profiles";

interface SavedProfile {
  id: string;
  name: string;
  savedAt: number;
  selectedPetName: string;
  level: number;
  rate: number;
  cardRank: number;
  modGrade: number;
  skillSlots: number;
  isMaxStar: boolean;
  base: number[];
  lost: number[];
  rand: number[];
  manual: number[];
  observedHP: number;
  observedMP: number;
  observedATK: number;
  observedDEF: number;
  observedAGI: number;
  observedSPT: number;
  observedREC: number;
  isReversed: boolean;
  reverseMode: boolean;
}

function loadProfilesLocal(): SavedProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProfilesLocal(profiles: SavedProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function profileToRow(p: SavedProfile) {
  return {
    id: p.id,
    name: p.name,
    saved_at: new Date(p.savedAt).toISOString(),
    pet_name: p.selectedPetName || null,
    level: p.level,
    card_rank: p.cardRank,
    mod_grade: p.modGrade,
    rate: p.rate,
    rand_sum: p.rand.reduce((a: number, b: number) => a + b, 0),
    is_reversed: p.isReversed,
    profile_data: {
      selectedPetName: p.selectedPetName,
      level: p.level,
      rate: p.rate,
      cardRank: p.cardRank,
      modGrade: p.modGrade,
      skillSlots: p.skillSlots,
      isMaxStar: p.isMaxStar,
      base: p.base,
      lost: p.lost,
      rand: p.rand,
      manual: p.manual,
      observedHP: p.observedHP,
      observedMP: p.observedMP,
      observedATK: p.observedATK,
      observedDEF: p.observedDEF,
      observedAGI: p.observedAGI,
      observedSPT: p.observedSPT,
      observedREC: p.observedREC,
      isReversed: p.isReversed,
      reverseMode: p.reverseMode,
    },
  };
}

function rowToProfile(row: { id: string; name: string; saved_at: string; profile_data: Record<string, unknown> }): SavedProfile {
  const d = row.profile_data as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    savedAt: new Date(row.saved_at).getTime(),
    selectedPetName: (d.selectedPetName as string) || "",
    level: (d.level as number) || 120,
    rate: (d.rate as number) || 0.2,
    cardRank: (d.cardRank as number) || 0,
    modGrade: (d.modGrade as number) || 0,
    skillSlots: (d.skillSlots as number) || 8,
    isMaxStar: (d.isMaxStar as boolean) || false,
    base: (d.base as number[]) || [30, 35, 30, 25, 20],
    lost: (d.lost as number[]) || [0, 0, 0, 0, 0],
    rand: (d.rand as number[]) || [2, 2, 2, 2, 2],
    manual: (d.manual as number[]) || [0, 0, 0, 0, 0],
    observedHP: (d.observedHP as number) || 0,
    observedMP: (d.observedMP as number) || 0,
    observedATK: (d.observedATK as number) || 0,
    observedDEF: (d.observedDEF as number) || 0,
    observedAGI: (d.observedAGI as number) || 0,
    observedSPT: (d.observedSPT as number) || 0,
    observedREC: (d.observedREC as number) || 0,
    isReversed: (d.isReversed as boolean) || false,
    reverseMode: (d.reverseMode as boolean) || false,
  };
}

export function PetCalculator() {
  // Filters
  const [raceFilter, setRaceFilter] = useState("");
  const [cardTypeFilter, setCardTypeFilter] = useState("");
  const [selectedPetName, setSelectedPetName] = useState("");

  // Basic params
  const [level, setLevel] = useState(120);
  const [rate, setRate] = useState(0.2);
  const [cardRank, setCardRank] = useState(0); // 0=無, 6=普, 7=銀, 8=金
  const [modGrade, setModGrade] = useState(0);
  const [skillSlots, setSkillSlots] = useState(8);
  const [isMaxStar, setIsMaxStar] = useState(false);

  // 5-stat arrays: [vit, str, def, agi, mag]
  const [base, setBase] = useState([30, 35, 30, 25, 20]);
  const [lost, setLost] = useState([0, 0, 0, 0, 0]);
  const [rand, setRand] = useState([2, 2, 2, 2, 2]);
  const [manual, setManual] = useState([0, 0, 0, 0, 0]);

  // Reverse calc mode
  const [reverseMode, setReverseMode] = useState(false);
  const [isReversed, setIsReversed] = useState(false);
  const [reverseUnused, setReverseUnused] = useState(0);
  const [observedHP, setObservedHP] = useState(0);
  const [observedMP, setObservedMP] = useState(0);
  const [observedATK, setObservedATK] = useState(0);
  const [observedDEF, setObservedDEF] = useState(0);
  const [observedAGI, setObservedAGI] = useState(0);
  const [observedSPT, setObservedSPT] = useState(0);
  const [observedREC, setObservedREC] = useState(0);

  // Saved profiles
  const [savedProfiles, setSavedProfiles] = useState<SavedProfile[]>([]);
  const [saveName, setSaveName] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  // Load profiles from Supabase on mount, fallback to localStorage
  useEffect(() => {
    async function load() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("pet_calc_profiles")
          .select("*")
          .order("saved_at", { ascending: false });
        if (!error && data && data.length > 0) {
          const profiles = data.map(rowToProfile);
          setSavedProfiles(profiles);
          saveProfilesLocal(profiles);
          return;
        }
      } catch {
        // Supabase unavailable, use localStorage
      }
      setSavedProfiles(loadProfilesLocal());
    }
    load();
  }, []);

  const handleSaveProfile = async () => {
    const name = saveName.trim() || (selectedPetName ? `${selectedPetName} Lv${level}` : `Lv${level} ${new Date().toLocaleString("zh-TW")}`);
    const profile: SavedProfile = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      savedAt: Date.now(),
      selectedPetName,
      level,
      rate,
      cardRank,
      modGrade,
      skillSlots,
      isMaxStar,
      base: [...base],
      lost: [...lost],
      rand: [...rand],
      manual: [...manual],
      observedHP,
      observedMP,
      observedATK,
      observedDEF,
      observedAGI,
      observedSPT,
      observedREC,
      isReversed,
      reverseMode,
    };
    const updated = [profile, ...savedProfiles];
    setSavedProfiles(updated);
    saveProfilesLocal(updated);
    setSaveName("");

    // Sync to Supabase
    try {
      setIsSyncing(true);
      const supabase = createClient();
      await supabase.from("pet_calc_profiles").insert(profileToRow(profile));
    } catch {
      // silent fail for cloud sync
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLoadProfile = (profile: SavedProfile) => {
    setSelectedPetName(profile.selectedPetName);
    setLevel(profile.level);
    setRate(profile.rate);
    setCardRank(profile.cardRank);
    setModGrade(profile.modGrade);
    setSkillSlots(profile.skillSlots);
    setIsMaxStar(profile.isMaxStar);
    setBase([...profile.base]);
    setLost([...profile.lost]);
    setRand([...profile.rand]);
    setManual([...profile.manual]);
    setObservedHP(profile.observedHP);
    setObservedMP(profile.observedMP);
    setObservedATK(profile.observedATK);
    setObservedDEF(profile.observedDEF);
    setObservedAGI(profile.observedAGI);
    setObservedSPT(profile.observedSPT);
    setObservedREC(profile.observedREC);
    setIsReversed(profile.isReversed);
    setReverseMode(profile.reverseMode);
    // Set filters to match if pet exists
    if (profile.selectedPetName) {
      const pet = allPets.find((p) => p.name === profile.selectedPetName);
      if (pet) {
        setRaceFilter(pet.race);
        setCardTypeFilter(pet.cardType);
      }
    }
  };

  const handleDeleteProfile = async (id: string) => {
    const updated = savedProfiles.filter((p) => p.id !== id);
    setSavedProfiles(updated);
    saveProfilesLocal(updated);

    // Delete from Supabase
    try {
      const supabase = createClient();
      await supabase.from("pet_calc_profiles").delete().eq("id", id);
    } catch {
      // silent fail
    }
  };

  // Filtered pets
  const filteredPets = useMemo(() => {
    return allPets.filter((p) => {
      if (raceFilter && raceFilter !== "all" && p.race !== raceFilter) return false;
      if (cardTypeFilter && cardTypeFilter !== "all" && !p.cardType.includes(cardTypeFilter)) return false;
      return true;
    });
  }, [raceFilter, cardTypeFilter]);

  // Apply pet to inputs (takes explicit maxStar to avoid stale closure)
  const applyPet = useCallback(
    (petName: string, maxStar: boolean) => {
      const pet = allPets.find((p) => p.name === petName);
      if (!pet) return;

      let bases = [pet.hp, pet.power, pet.defense, pet.speed, pet.magic];

      // Max star processing
      const target = CARD_TYPE_MAX_TOTAL[pet.cardType] || 0;
      const missing = Math.max(target - pet.total, 0);
      if (maxStar && target > 0 && missing > 0) {
        const add = missing / 5;
        bases = bases.map((v) =>
          Number.isInteger(add) ? v + add : parseFloat((v + add).toFixed(1))
        );
      }

      setBase(bases);
      setLost([0, 0, 0, 0, 0]);
      setRand([2, 2, 2, 2, 2]);
      setManual([0, 0, 0, 0, 0]);
      setIsReversed(false);

      // Auto set card rank and rate
      const rankMap: Record<string, number> = { "金": 8, "銀": 7, "普": 6 };
      setCardRank(rankMap[pet.cardType] || 0);
      setRate(CARD_TYPE_RATE[pet.cardType] || 0.2);
      setSkillSlots(pet.skillSlots || 8);
    },
    []
  );

  // Current calculation input
  const calcInput: CalcInput = useMemo(
    () => ({
      level,
      rate,
      base,
      lost,
      rand,
      manual,
      cardRank,
      modGrade,
      skillSlots,
    }),
    [level, rate, base, lost, rand, manual, cardRank, modGrade, skillSlots]
  );

  // Calculate stats
  const stats: FinalStats = useMemo(() => calculateStats(calcInput), [calcInput]);
  const rawStats: RawStats = useMemo(() => calculateStatsRaw(calcInput), [calcInput]);

  // Calculate point info
  const pointInfo = useMemo(() => calculatePointInfo(calcInput), [calcInput]);

  // Calculate score
  const fullBonusValue = useMemo(() => {
    if (cardRank === 0) return 0;
    // Map card rank BP to card type for full bonus
    const rankToType: Record<number, string> = { 8: "金", 7: "銀", 6: "普" };
    return CARD_FULL_BONUS[rankToType[cardRank]] || 0;
  }, [cardRank]);

  // Score uses raw (non-floored) stats — the game calculates score from precise values
  const score = useMemo(
    () => calculateScore(rawStats as FinalStats, skillSlots, level, fullBonusValue),
    [rawStats, skillSlots, level, fullBonusValue]
  );

  // Random rank sum
  const randSum = rand.reduce((a, b) => a + b, 0);

  // Modification potential simulation — predict score at each modGrade (0~5)
  const modSimulation = useMemo(() => {
    if (cardRank === 0) return null;

    // Find dominant stat (most manual allocation); fallback to highest base
    let dominantIdx = 0;
    for (let i = 1; i < 5; i++) {
      if (manual[i] > manual[dominantIdx]) dominantIdx = i;
    }
    if (manual.every((v) => v === 0)) {
      for (let i = 1; i < 5; i++) {
        if (base[i] > base[dominantIdx]) dominantIdx = i;
      }
    }

    return Array.from({ length: 6 }, (_, simMod) => {
      const simLimit = Math.max(0, level - 1) + cardRank * simMod;

      // Keep other stats same, adjust dominant to fill up to simLimit
      const simManual = [...manual];
      const otherSum = manual.reduce(
        (a, b, i) => (i === dominantIdx ? a : a + b),
        0
      );
      simManual[dominantIdx] = Math.max(0, simLimit - otherSum);

      const simInput: CalcInput = {
        level,
        rate,
        base,
        lost,
        rand,
        manual: simManual,
        cardRank,
        modGrade: simMod,
        skillSlots,
      };

      const simRawStats = calculateStatsRaw(simInput);
      const simScore = calculateScore(simRawStats as FinalStats, skillSlots, level, fullBonusValue);

      return {
        mod: simMod,
        totalLimit: simLimit,
        score: simScore.total,
        isCurrent: simMod === modGrade,
        dominantLabel: FIVE_STAT_SHORT[dominantIdx],
      };
    });
  }, [cardRank, level, rate, base, lost, rand, manual, skillSlots, fullBonusValue, modGrade]);

  // Star status for selected pet
  const selectedPet = allPets.find((p) => p.name === selectedPetName);
  const starInfo = useMemo(() => {
    if (!selectedPet) return null;
    const target = CARD_TYPE_MAX_TOTAL[selectedPet.cardType] || 0;
    const missing = Math.max(target - selectedPet.total, 0);
    return { target, missing, isFull: missing === 0 };
  }, [selectedPet]);

  // Helper to update array state
  const updateArr = (
    setter: React.Dispatch<React.SetStateAction<number[]>>,
    idx: number,
    val: number
  ) => {
    setter((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  // One-click max stat
  const maxOneStat = (idx: number) => {
    const newManual = [0, 0, 0, 0, 0];
    newManual[idx] = 9999; // Will be capped by calculatePointInfo
    setManual(newManual);
  };

  // Reverse calculation — auto-search unused BP (0~5)
  const doReverseCalc = () => {
    const observed = {
      hp: observedHP, mp: observedMP, atk: observedATK,
      def: observedDEF, agi: observedAGI,
    };
    const manualArr = pointInfo.manualCapped;

    // Find stat with the most manual allocation (most likely to have unused)
    let maxIdx = 0;
    for (let i = 1; i < 5; i++) {
      if (manualArr[i] > manualArr[maxIdx]) maxIdx = i;
    }

    let bestRand: number[] = [];
    let bestUnused = 0;
    let bestPenalty = Infinity;

    for (let unused = 0; unused <= 5; unused++) {
      const adjusted = [...manualArr];
      if (adjusted[maxIdx] < unused) break;
      adjusted[maxIdx] -= unused;

      const raw = reverseStatsToRandom(observed, level, rate, base, lost, adjusted);
      const sum = raw.reduce((a, b) => a + b, 0);

      // Penalty: heavily penalize negatives and >10; penalize sum>10; prefer fewer unused
      let penalty = 0;
      for (const r of raw) {
        if (r < 0) penalty += r * r * 100;
        if (r > 10) penalty += (r - 10) * (r - 10) * 10;
      }
      if (sum > 10) penalty += (sum - 10) * (sum - 10);
      if (sum < 0) penalty += 10000;
      penalty += unused * 0.01;

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestRand = raw.map((r) => Math.max(0, Math.min(10, r)));
        bestUnused = unused;
      }
    }

    setRand(bestRand);
    setReverseUnused(bestUnused);
    setIsReversed(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            寵物檔位計算模擬器
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            選擇寵物、設定參數，計算能力值與評分。支持反推隨機檔分布。
          </p>
        </div>
        <Link href="/">
          <Button variant="outline" size="sm">
            返回市場
          </Button>
        </Link>
      </div>

      {/* Save / Load Profiles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            存檔記錄
            <Badge variant="outline" className="text-xs font-normal">
              {savedProfiles.length} 筆
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Save current */}
          <div className="flex gap-2">
            <Input
              placeholder={selectedPetName ? `${selectedPetName} Lv${level}` : "輸入名稱"}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveProfile(); }}
            />
            <Button size="sm" className="h-8 whitespace-nowrap" onClick={handleSaveProfile} disabled={isSyncing}>
              {isSyncing ? "儲存中..." : "儲存目前設定"}
            </Button>
          </div>

          {/* Saved profiles list */}
          {savedProfiles.length > 0 && (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {savedProfiles.map((p) => {
                const rSum = p.rand.reduce((a: number, b: number) => a + b, 0);
                const rankToCard: Record<number, string> = { 8: "金", 7: "銀", 6: "普" };
                const cardLabel = rankToCard[p.cardRank] || "";
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-md px-3 py-2 group hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                    onClick={() => handleLoadProfile(p)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {p.name}
                      </div>
                      <div className="flex gap-2 text-[11px] text-zinc-500 flex-wrap">
                        {cardLabel && <span>{cardLabel}卡</span>}
                        <span>Lv{p.level}</span>
                        {p.modGrade > 0 && <span>{p.modGrade}改</span>}
                        <span>倍率{p.rate}</span>
                        {p.isReversed && (
                          <span className={`font-bold ${
                            rSum >= 30 ? "text-green-600 dark:text-green-400" :
                            rSum >= 20 ? "text-green-600 dark:text-green-400" :
                            rSum >= 10 ? "text-zinc-600 dark:text-zinc-300" : "text-amber-500"
                          }`}>
                            隨機檔={rSum} {rSum >= 30 ? "極品" : rSum >= 20 ? "優秀" : rSum >= 10 ? "普通" : "偏低"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-400 whitespace-nowrap">
                      {new Date(p.savedAt).toLocaleDateString("zh-TW")}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteProfile(p.id);
                      }}
                    >
                      x
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Settings */}
        <div className="lg:col-span-2 space-y-4">
          {/* Pet Selection */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">選擇寵物</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    種族
                  </label>
                  <Select value={raceFilter} onValueChange={setRaceFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {RACES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    卡等
                  </label>
                  <Select value={cardTypeFilter} onValueChange={setCardTypeFilter}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      <SelectItem value="金">金卡</SelectItem>
                      <SelectItem value="銀">銀卡</SelectItem>
                      <SelectItem value="普">普卡</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 sm:col-span-1 flex items-end gap-2">
                  <Button
                    variant={isMaxStar ? "default" : "outline"}
                    size="sm"
                    className="whitespace-nowrap"
                    onClick={() => {
                      const newMaxStar = !isMaxStar;
                      setIsMaxStar(newMaxStar);
                      if (selectedPetName) {
                        applyPet(selectedPetName, newMaxStar);
                      }
                    }}
                  >
                    一鍵滿星：{isMaxStar ? "ON" : "OFF"}
                  </Button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-500 mb-1 block">
                  選擇圖鑑寵物 ({filteredPets.length} 隻)
                </label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedPetName}
                  onChange={(e) => {
                    setSelectedPetName(e.target.value);
                    if (e.target.value) applyPet(e.target.value, isMaxStar);
                  }}
                >
                  <option value="">請選擇</option>
                  {filteredPets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} [{p.cardType}] ({p.total})
                    </option>
                  ))}
                </select>
              </div>

              {starInfo && (
                <div className="flex gap-2 flex-wrap">
                  {starInfo.isFull ? (
                    <Badge variant="default" className="bg-amber-500">
                      天生滿星
                    </Badge>
                  ) : isMaxStar ? (
                    <Badge variant="secondary">
                      已補星 +{starInfo.missing}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      缺少 {starInfo.missing} 星
                    </Badge>
                  )}
                  {selectedPet && (
                    <>
                      <Badge variant="outline">{selectedPet.race}</Badge>
                      <Badge variant="outline">{selectedPet.skillSlots} 技能欄</Badge>
                      <Badge variant="outline">洗檔 {selectedPet.washPrice}</Badge>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Basic Params */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">基本參數</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    等級 (Lv)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={level}
                    onChange={(e) => setLevel(Number(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    初始倍率
                  </label>
                  <Input
                    type="number"
                    step={0.01}
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value) || 0.2)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    卡片等級
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={cardRank}
                    onChange={(e) => {
                      const rank = Number(e.target.value);
                      setCardRank(rank);
                      const rateMap: Record<number, number> = { 8: 0.25, 7: 0.20, 6: 0.15 };
                      if (rateMap[rank] !== undefined) setRate(rateMap[rank]);
                    }}
                  >
                    <option value={0}>無改造</option>
                    <option value={6}>普卡 (+6 BP/改, 倍率0.15)</option>
                    <option value={7}>銀卡 (+7 BP/改, 倍率0.20)</option>
                    <option value={8}>金卡 (+8 BP/改, 倍率0.25)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-500 mb-1 block">
                    改造次數
                  </label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                    value={modGrade}
                    onChange={(e) => setModGrade(Number(e.target.value))}
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n} 改
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Skill slots */}
              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-500 mb-1.5 block">
                  技能欄數量 (6~10)
                </label>
                <div className="flex gap-2">
                  {[6, 7, 8, 9, 10].map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      variant={skillSlots === n ? "default" : "outline"}
                      onClick={() => setSkillSlots(n)}
                      className="w-10"
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stat Grid */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">檔位與配點</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Header Row */}
              <div className="grid grid-cols-6 gap-2 mb-2 text-xs font-medium text-zinc-500 text-center">
                <div></div>
                {FIVE_STAT_LABELS.map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </div>

              {/* Base Rank Row */}
              <div className="grid grid-cols-6 gap-2 mb-2 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  原始檔次
                </div>
                {base.map((v, i) => (
                  <Input
                    key={i}
                    type="number"
                    value={v}
                    onChange={(e) => updateArr(setBase, i, Number(e.target.value) || 0)}
                    className="text-center text-sm h-8 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800"
                  />
                ))}
              </div>

              {/* Lost Rank Row */}
              <div className="grid grid-cols-6 gap-2 mb-2 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  掉檔
                </div>
                {lost.map((v, i) => (
                  <select
                    key={i}
                    className="w-full h-8 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-1 text-sm text-center"
                    value={v}
                    onChange={(e) => updateArr(setLost, i, Number(e.target.value))}
                  >
                    {[0, -1, -2, -3, -4].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                ))}
              </div>

              {/* Random Rank Row */}
              <div className="grid grid-cols-6 gap-2 mb-1 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  隨機檔
                </div>
                {rand.map((v, i) => (
                  <Input
                    key={i}
                    type="number"
                    min={0}
                    max={10}
                    value={v}
                    onChange={(e) => {
                      updateArr(setRand, i, Math.max(0, Number(e.target.value) || 0));
                      setIsReversed(false);
                    }}
                    className="text-center text-sm h-8"
                  />
                ))}
              </div>

              {/* Random sum info */}
              <div className="flex justify-between items-center bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-1.5 mb-2 text-xs">
                <span className="text-zinc-500">
                  隨機檔總和{isReversed ? " (反推結果)" : " (每項0~10)"}
                </span>
                <span
                  className={`font-mono font-bold ${
                    randSum >= 30
                      ? "text-green-600 dark:text-green-400"
                      : randSum >= 20
                        ? "text-green-600 dark:text-green-400"
                        : randSum >= 10
                          ? "text-zinc-700 dark:text-zinc-300"
                          : "text-amber-500"
                  }`}
                >
                  {randSum}
                  {isReversed && (
                    <span className={`ml-2 ${
                      randSum >= 30 ? "text-green-600 dark:text-green-400" :
                      randSum >= 20 ? "text-green-600 dark:text-green-400" :
                      randSum >= 10 ? "text-zinc-500" : "text-amber-500"
                    }`}>
                      {randSum >= 30 ? "極品" : randSum >= 20 ? "優秀" : randSum >= 10 ? "普通" : "偏低"}
                    </span>
                  )}
                </span>
              </div>

              {/* Manual Points Row */}
              <div className="grid grid-cols-6 gap-2 mb-1 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  配點
                </div>
                {manual.map((v, i) => (
                  <Input
                    key={i}
                    type="number"
                    min={0}
                    value={v}
                    onChange={(e) =>
                      updateArr(setManual, i, Math.max(0, Number(e.target.value) || 0))
                    }
                    className="text-center text-sm h-8"
                  />
                ))}
              </div>

              {/* Per-stat cap row */}
              <div className="grid grid-cols-6 gap-2 mb-1 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  單項上限
                </div>
                {pointInfo.perStatMaxBP.map((cap, i) => (
                  <div
                    key={i}
                    className={`text-center text-xs font-mono ${
                      manual[i] > cap
                        ? "text-amber-500 font-bold"
                        : "text-zinc-400"
                    }`}
                  >
                    {cap}
                    {manual[i] > cap && (
                      <span className="text-amber-500"> +{manual[i] - cap}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Points status */}
              <div className="flex justify-between items-center bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-1.5 mb-2 text-xs">
                <span className="text-zinc-500">可用點數 (升級+改造)</span>
                <span
                  className={`font-mono font-bold ${
                    pointInfo.overLimit
                      ? "text-red-500"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {pointInfo.currentUsed} / {pointInfo.totalLimit} (剩餘{" "}
                  {pointInfo.remaining})
                  {pointInfo.overLimit && (
                    <span className="text-red-500 ml-2">超過上限!</span>
                  )}
                </span>
              </div>

              {/* Quick max stat buttons */}
              <div className="grid grid-cols-6 gap-2 items-center">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 text-right pr-1">
                  一鍵點滿
                </div>
                {FIVE_STAT_SHORT.map((label, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => maxOneStat(i)}
                  >
                    全{label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Results */}
        <div className="space-y-4">
          {/* Stats Result */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">計算結果</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-center text-xs">屬性</TableHead>
                    <TableHead className="text-center text-xs">數值</TableHead>
                    <TableHead className="text-center text-xs">精確值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      ["HP", stats.hp, rawStats.hp],
                      ["MP", stats.mp, rawStats.mp],
                      ["攻擊", stats.atk, rawStats.atk],
                      ["防禦", stats.def, rawStats.def],
                      ["敏捷", stats.agi, rawStats.agi],
                      ["精神", stats.spt, rawStats.spt],
                      ["回復", stats.rec, rawStats.rec],
                    ] as [string, number, number][]
                  ).map(([name, val, raw]) => (
                    <TableRow key={name}>
                      <TableCell className="text-center text-sm font-medium">
                        {name}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm font-bold">
                        {val}
                      </TableCell>
                      <TableCell className="text-center font-mono text-xs text-zinc-400">
                        {raw.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Score */}
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">評分</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center mb-3">
                <div className="text-4xl font-black text-primary">
                  {score.total}
                </div>
                <div className="text-xs text-zinc-500 mt-1">總評分</div>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-500">基礎分</span>
                  <span className="font-mono">
                    {score.baseScore.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">
                    技能加分 ({skillSlots}欄, 權重{SKILL_SLOT_WEIGHT[skillSlots] || 0})
                  </span>
                  <span className="font-mono">{score.skillScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">滿檔加分</span>
                  <span className="font-mono">+{score.fullBonus}</span>
                </div>
                <hr className="border-zinc-200 dark:border-zinc-700 my-1" />
                <details className="mt-2">
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                    展開各項貢獻
                  </summary>
                  <div className="mt-2 space-y-0.5">
                    {(
                      [
                        ["HP", "hp", rawStats.hp, SCORE_WEIGHTS.hp],
                        ["MP", "mp", rawStats.mp, SCORE_WEIGHTS.mp],
                        ["攻擊", "atk", rawStats.atk, SCORE_WEIGHTS.atk],
                        ["防禦", "def", rawStats.def, SCORE_WEIGHTS.def],
                        ["敏捷", "agi", rawStats.agi, SCORE_WEIGHTS.agi],
                        ["精神", "spr", rawStats.spt, SCORE_WEIGHTS.spr],
                        ["回復", "rec", rawStats.rec, SCORE_WEIGHTS.rec],
                      ] as [string, string, number, number][]
                    ).map(([name, key, val, w]) => (
                      <div key={key} className="flex justify-between text-[11px]">
                        <span className="text-zinc-400">
                          {name}: {val.toFixed(2)} x {w} / 3
                        </span>
                        <span className="font-mono">
                          {((val * w) / 3).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            </CardContent>
          </Card>

          {/* Modification Potential Simulation */}
          {modSimulation && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">改造潛力模擬</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-zinc-500 mb-2">
                  固定隨機檔，模擬不同改造等級的預測評分
                  （多餘配點加至{modSimulation[0].dominantLabel}）
                </p>
                <div className="space-y-1">
                  {modSimulation.map((sim) => (
                    <div
                      key={sim.mod}
                      className={`flex items-center justify-between rounded px-3 py-1.5 text-sm ${
                        sim.isCurrent
                          ? "bg-primary/10 border border-primary/30"
                          : "bg-zinc-50 dark:bg-zinc-800/50"
                      }`}
                    >
                      <span className={`text-xs w-12 ${sim.isCurrent ? "font-bold" : ""}`}>
                        {sim.mod}改
                        {sim.isCurrent && (
                          <span className="text-primary text-[10px] ml-0.5">*</span>
                        )}
                      </span>
                      <span className="text-xs text-zinc-500 w-16 text-center">
                        配點 {sim.totalLimit}
                      </span>
                      <span className={`font-mono text-sm ${sim.isCurrent ? "font-bold" : ""}`}>
                        {sim.score}
                      </span>
                      <span
                        className={`text-xs font-mono w-14 text-right ${
                          sim.isCurrent
                            ? "text-zinc-400"
                            : sim.score > score.total
                              ? "text-green-600 dark:text-green-400"
                              : sim.score < score.total
                                ? "text-red-500"
                                : "text-zinc-400"
                        }`}
                      >
                        {sim.isCurrent
                          ? "當前"
                          : `${sim.score >= score.total ? "+" : ""}${sim.score - score.total}`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-400 mt-2">
                  隨機檔為寵物天生素質，不隨改造變化。同隨機檔的寵物在相同改造等級下評分相同。
                </p>
              </CardContent>
            </Card>
          )}

          {/* Reverse Calculation */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                反推隨機檔
                <Button
                  variant={reverseMode ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-6"
                  onClick={() => setReverseMode(!reverseMode)}
                >
                  {reverseMode ? "收起" : "展開"}
                </Button>
              </CardTitle>
            </CardHeader>
            {reverseMode && (
              <CardContent className="space-y-3">
                <p className="text-xs text-zinc-500">
                  輸入遊戲中觀察到的實際能力值，反推隨機檔分布。
                  請先設定好寵物、等級、掉檔與配點。支持小數(電腦版)。
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["HP", observedHP, setObservedHP],
                      ["ATK", observedATK, setObservedATK],
                      ["MP", observedMP, setObservedMP],
                      ["DEF", observedDEF, setObservedDEF],
                      ["回復", observedREC, setObservedREC],
                      ["AGI", observedAGI, setObservedAGI],
                      ["精神", observedSPT, setObservedSPT],
                    ] as [string, number, (v: number) => void][]
                  ).map(([label, val, setter]) => (
                    <div key={label}>
                      <label className="text-xs text-zinc-500 mb-0.5 block">
                        {label}
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={val}
                        onChange={(e) =>
                          setter(Number(e.target.value) || 0)
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={doReverseCalc}
                >
                  反推隨機檔
                </Button>
                {isReversed && reverseUnused > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                    偵測到可能有 <span className="font-bold">{reverseUnused}</span> 點未使用配點（已自動調整）
                  </div>
                )}
                {isReversed && (observedSPT > 0 || observedREC > 0) && (
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded px-3 py-2 text-xs space-y-1">
                    <div className="text-zinc-500 font-medium">交叉驗證 (精神/回復)</div>
                    {observedSPT > 0 && (
                      <div className="flex justify-between">
                        <span>精神</span>
                        <span className="font-mono">
                          計算 {rawStats.spt.toFixed(2)} vs 觀察 {observedSPT}
                          <span className={`ml-2 ${Math.abs(rawStats.spt - observedSPT) < 1 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
                            (差 {Math.abs(rawStats.spt - observedSPT).toFixed(2)})
                          </span>
                        </span>
                      </div>
                    )}
                    {observedREC > 0 && (
                      <div className="flex justify-between">
                        <span>回復</span>
                        <span className="font-mono">
                          計算 {rawStats.rec.toFixed(2)} vs 觀察 {observedREC}
                          <span className={`ml-2 ${Math.abs(rawStats.rec - observedREC) < 1 ? "text-green-600 dark:text-green-400" : "text-amber-500"}`}>
                            (差 {Math.abs(rawStats.rec - observedREC).toFixed(2)})
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-zinc-400">
                  由於取整誤差，結果為近似值。精神/回復用於交叉驗證。
                </p>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
