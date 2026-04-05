"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import {
  defaultEnergyData,
  ensureUserProfile,
  saveUserEnergyData,
  subscribeUserProfile,
  type UserProfile,
} from "@/lib/firestore";

type Device = {
  id: number;
  name: string;
  power: number;
  quantity: number;
  hours: number;
};

type BillingMode = "Đơn giá cố định" | "Biểu giá EVN";
type SortMode = "Tên A-Z" | "Điện năng giảm dần" | "Công suất giảm dần";
type UsageType = "Sinh hoạt / Trường học" | "Doanh nghiệp / Công ty";

const presetWatts: Record<string, number> = {
  Quạt: 75,
  "Đèn LED": 20,
  "Máy chiếu": 250,
  Tivi: 120,
  "Tủ lạnh": 150,
  "Điều hòa": 1200,
  "Máy tính": 200,
  "Máy in": 350,
  "Máy bơm": 750,
  "Máy photocopy": 1500,
};

const tabs = [
  "Bắt đầu",
  "Nhập thiết bị",
  "Mức tiêu thụ điện và giá tiền",
  "Gợi ý thông minh",
];

const EVN_TIERS = [
  { limit: 50, price: 1806 },
  { limit: 50, price: 1866 },
  { limit: 100, price: 2167 },
  { limit: 100, price: 2729 },
  { limit: 100, price: 3050 },
  { limit: Infinity, price: 3151 },
];

const dailyTips = [
  "Tắt quạt và đèn khi không sử dụng.",
  "Tận dụng ánh sáng tự nhiên vào ban ngày.",
  "Rút sạc thiết bị khi không dùng.",
  "Ưu tiên sử dụng đèn LED để tiết kiệm điện.",
  "Giảm 1 giờ sử dụng thiết bị mỗi ngày cũng giúp tiết kiệm đáng kể.",
  "Vệ sinh thiết bị định kỳ để tăng hiệu suất và giảm hao điện.",
];

function calculateEVNCost(kwh: number) {
  let remaining = Math.max(0, Math.floor(kwh * 100) / 100);
  let total = 0;
  const breakdown: { label: string; kwh: number; price: number; cost: number }[] = [];

  for (let i = 0; i < EVN_TIERS.length; i++) {
    if (remaining <= 0) break;

    const tier = EVN_TIERS[i];
    const used = Math.min(remaining, tier.limit);
    const cost = used * tier.price;
    total += cost;

    breakdown.push({
      label: `Bậc ${i + 1}`,
      kwh: used,
      price: tier.price,
      cost,
    });

    remaining -= used;
  }

  return { total, breakdown };
}

function estimateCO2(kwh: number) {
  return kwh * 0.82;
}

export default function Page() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [email, setEmail] = useState("");
  const [passwordLogin, setPasswordLogin] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");

  const [activeTab, setActiveTab] = useState("Bắt đầu");
  const [usageType, setUsageType] = useState<UsageType>("Sinh hoạt / Trường học");
  const [billingMode, setBillingMode] = useState<BillingMode>("Biểu giá EVN");

  const [devices, setDevices] = useState<Device[]>([]);
  const [preset, setPreset] = useState("");
  const [name, setName] = useState("");
  const [power, setPower] = useState("");
  const [quantity, setQuantity] = useState("");
  const [hours, setHours] = useState("");
  const [price, setPrice] = useState("0");
  const [days, setDays] = useState("0");
  const [savingGoal, setSavingGoal] = useState("0");

  const [searchKeyword, setSearchKeyword] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("Tên A-Z");
  const [showGoToResult, setShowGoToResult] = useState(false);

  const [savedEnergy, setSavedEnergy] = useState(0);
  const [savedCost, setSavedCost] = useState(0);

  const [randomTip, setRandomTip] = useState(dailyTips[0]);

  const [aiResult, setAiResult] = useState("Chưa có gợi ý.");
  const [aiLoading, setAiLoading] = useState(false);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPower, setEditPower] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editHours, setEditHours] = useState("");

  const chartRef = useRef<HTMLCanvasElement | null>(null);

  const isLoggedIn = !!currentUser;
  const isAdmin = userProfile?.role === "admin";

  useEffect(() => {
    setRandomTip(dailyTips[Math.floor(Math.random() * dailyTips.length)]);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setCurrentUser(firebaseUser);

      if (!firebaseUser) {
        setUserProfile(null);
        setDevices([]);
        setUsageType(defaultEnergyData.usageType);
        setBillingMode(defaultEnergyData.billingMode);
        setPrice(defaultEnergyData.price);
        setDays(defaultEnergyData.days);
        setSavingGoal(defaultEnergyData.savingGoal);
        setSavedEnergy(defaultEnergyData.savedEnergy);
        setSavedCost(defaultEnergyData.savedCost);
        setAuthLoading(false);
        return;
      }

      const forceAdmin =
        firebaseUser.email?.toLowerCase() ===
        (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").toLowerCase();

      await ensureUserProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        forceAdmin,
      });

      const unsubProfile = subscribeUserProfile(firebaseUser.uid, (profile) => {
        setUserProfile(profile);

        if (profile?.data) {
          setDevices(profile.data.devices || []);
          setUsageType(profile.data.usageType || defaultEnergyData.usageType);
          setBillingMode(profile.data.billingMode || defaultEnergyData.billingMode);
          setPrice(profile.data.price || defaultEnergyData.price);
          setDays(profile.data.days || defaultEnergyData.days);
          setSavingGoal(profile.data.savingGoal || defaultEnergyData.savingGoal);
          setSavedEnergy(profile.data.savedEnergy || 0);
          setSavedCost(profile.data.savedCost || 0);
        } else {
          setDevices(defaultEnergyData.devices);
          setUsageType(defaultEnergyData.usageType);
          setBillingMode(defaultEnergyData.billingMode);
          setPrice(defaultEnergyData.price);
          setDays(defaultEnergyData.days);
          setSavingGoal(defaultEnergyData.savingGoal);
          setSavedEnergy(defaultEnergyData.savedEnergy);
          setSavedCost(defaultEnergyData.savedCost);
        }

        setAuthLoading(false);
      });

      return () => unsubProfile();
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!currentUser || authLoading) return;

    const timeout = setTimeout(() => {
      saveUserEnergyData(currentUser.uid, {
        usageType,
        billingMode,
        devices,
        price,
        days,
        savingGoal,
        savedEnergy,
        savedCost,
      }).catch(console.error);
    }, 500);

    return () => clearTimeout(timeout);
  }, [
    currentUser,
    authLoading,
    usageType,
    billingMode,
    devices,
    price,
    days,
    savingGoal,
    savedEnergy,
    savedCost,
  ]);

  useEffect(() => {
    if (usageType === "Doanh nghiệp / Công ty") {
      setBillingMode("Đơn giá cố định");
      if (!price || Number(price) < 0) {
        setPrice("0");
      }
    }
  }, [usageType, price]);

  const safePrice = Number(price) >= 0 ? Number(price) : 0;
  const safeDays = Number(days) >= 0 ? Number(days) : 0;
  const safeGoal = Number(savingGoal) >= 0 ? Number(savingGoal) : 0;

  const totalDay = useMemo(() => {
    return devices.reduce((sum, d) => {
      const value =
        ((Number(d.power) || 0) *
          (Number(d.quantity) || 0) *
          (Number(d.hours) || 0)) /
        1000;
      return sum + value;
    }, 0);
  }, [devices]);

  const totalPeriod = useMemo(() => totalDay * safeDays, [totalDay, safeDays]);

  const evnResult = useMemo(() => calculateEVNCost(totalPeriod), [totalPeriod]);

  const totalCost = useMemo(() => {
    if (usageType === "Doanh nghiệp / Công ty") {
      return totalPeriod * safePrice;
    }
    if (billingMode === "Biểu giá EVN") return evnResult.total;
    return totalPeriod * safePrice;
  }, [usageType, billingMode, evnResult.total, totalPeriod, safePrice]);

  const topDevice = useMemo(() => {
    if (devices.length === 0) return null;
    return devices.reduce((max, current) => {
      const maxValue =
        ((max.power || 0) * (max.quantity || 0) * (max.hours || 0)) / 1000;
      const currentValue =
        ((current.power || 0) * (current.quantity || 0) * (current.hours || 0)) / 1000;
      return currentValue > maxValue ? current : max;
    });
  }, [devices]);

  const top3Devices = useMemo(() => {
    return [...devices]
      .sort((a, b) => {
        const aVal = ((a.power || 0) * (a.quantity || 0) * (a.hours || 0)) / 1000;
        const bVal = ((b.power || 0) * (b.quantity || 0) * (b.hours || 0)) / 1000;
        return bVal - aVal;
      })
      .slice(0, 3);
  }, [devices]);

  const warnings = useMemo(() => {
    const result: string[] = [];

    devices.forEach((d) => {
      const dailyKwh = ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000;

      if (d.power >= 100000) {
        result.push(`${d.name} có công suất cực lớn, cần kiểm tra lại vì dữ liệu có thể bất thường.`);
      }

      if (d.hours >= 8) {
        result.push(`${d.name} đang được sử dụng khá lâu trong ngày.`);
      }

      if (dailyKwh >= 20) {
        result.push(`${d.name} đang tiêu thụ điện rất cao mỗi ngày.`);
      }

      if (d.name.toLowerCase().includes("đèn") && d.hours >= 6) {
        result.push(`Thiết bị ${d.name} có thời gian chiếu sáng dài, nên tận dụng ánh sáng tự nhiên.`);
      }

      if (d.name.toLowerCase().includes("điều hòa") && d.hours >= 6) {
        result.push(`Điều hòa sử dụng nhiều giờ có thể làm chi phí điện tăng nhanh.`);
      }
    });

    if (totalCost > 500000) result.push("Chi phí điện ước tính đang ở mức khá cao.");
    if (totalPeriod > 1000) result.push("Tổng điện năng trong kỳ đang rất lớn, cần kiểm tra lại cách sử dụng điện.");
    if (result.length === 0) result.push("Mức sử dụng điện hiện tại tương đối hợp lý.");

    return result;
  }, [devices, totalCost, totalPeriod]);

  const filteredAndSortedDevices = useMemo(() => {
    const filtered = devices.filter((d) =>
      d.name.toLowerCase().includes(searchKeyword.toLowerCase())
    );

    const sorted = [...filtered];

    if (sortMode === "Tên A-Z") {
      sorted.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    }

    if (sortMode === "Điện năng giảm dần") {
      sorted.sort((a, b) => {
        const aVal = ((a.power || 0) * (a.quantity || 0) * (a.hours || 0)) / 1000;
        const bVal = ((b.power || 0) * (b.quantity || 0) * (b.hours || 0)) / 1000;
        return bVal - aVal;
      });
    }

    if (sortMode === "Công suất giảm dần") {
      sorted.sort((a, b) => (b.power || 0) - (a.power || 0));
    }

    return sorted;
  }, [devices, searchKeyword, sortMode]);

  const co2Current = useMemo(() => estimateCO2(totalPeriod), [totalPeriod]);
  const co2Saved = useMemo(() => estimateCO2(savedEnergy), [savedEnergy]);

  const goalProgress = useMemo(() => {
    if (safeGoal <= 0) return 0;
    const progress = (savedCost / safeGoal) * 100;
    return Math.max(0, Math.min(progress, 100));
  }, [savedCost, safeGoal]);

  const greenScore = useMemo(() => {
    if (devices.length === 0) return 0;

    let score = 100;

    if (totalCost > 500000) score -= 25;
    if (warnings.some((w) => w.toLowerCase().includes("bất thường"))) score -= 30;
    if (warnings.some((w) => w.toLowerCase().includes("rất cao"))) score -= 20;
    if (devices.some((d) => d.hours >= 8)) score -= 10;
    if (savedCost > 0) score += 10;

    return Math.max(0, Math.min(score, 100));
  }, [devices, totalCost, warnings, savedCost]);

  const greenBadge = useMemo(() => {
    if (greenScore >= 85) return "Huy hiệu Xanh xuất sắc";
    if (greenScore >= 65) return "Huy hiệu Sử dụng điện hợp lý";
    if (greenScore >= 40) return "Huy hiệu Cần tối ưu thêm";
    return "Huy hiệu Cần cải thiện";
  }, [greenScore]);

  const priorityActions = useMemo(() => {
    const actions: { title: string; note: string; saving: number }[] = [];

    devices.forEach((d) => {
      const dailyEnergy = ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000;
      const periodEnergy = dailyEnergy * safeDays;
      const estimatedPeriodCost =
        usageType === "Doanh nghiệp / Công ty"
          ? periodEnergy * safePrice
          : billingMode === "Biểu giá EVN"
          ? calculateEVNCost(periodEnergy).total
          : periodEnergy * safePrice;

      if (d.name.toLowerCase().includes("đèn")) {
        actions.push({
          title: `Giảm bớt đèn hoặc thay LED cho ${d.name}`,
          note: "Phù hợp khi phòng đủ sáng hoặc có thể dùng đèn tiết kiệm điện hơn.",
          saving: estimatedPeriodCost * 0.3,
        });
      }

      if (d.hours >= 5) {
        actions.push({
          title: `Giảm 1 giờ sử dụng mỗi ngày cho ${d.name}`,
          note: "Thao tác đơn giản, dễ áp dụng ngay.",
          saving: estimatedPeriodCost / Math.max(d.hours, 1),
        });
      }

      if (d.name.toLowerCase().includes("điều hòa")) {
        actions.push({
          title: `Tối ưu nhiệt độ điều hòa của ${d.name}`,
          note: "Đặt nhiệt độ hợp lý và tắt khi không cần thiết.",
          saving: estimatedPeriodCost * 0.2,
        });
      }

      if (d.name.toLowerCase().includes("máy chiếu")) {
        actions.push({
          title: `Tắt máy chiếu ngay sau khi sử dụng`,
          note: "Giảm hao điện không cần thiết.",
          saving: estimatedPeriodCost * 0.15,
        });
      }

      if (d.name.toLowerCase().includes("máy in") || d.name.toLowerCase().includes("máy photocopy")) {
        actions.push({
          title: `Tắt ${d.name} khi không dùng liên tục`,
          note: "Thiết bị văn phòng nên chuyển về chế độ nghỉ hoặc tắt hẳn nếu không sử dụng.",
          saving: estimatedPeriodCost * 0.18,
        });
      }
    });

    return actions
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 3);
  }, [devices, safeDays, billingMode, safePrice, usageType]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = chartRef.current;
      if (!canvas || activeTab !== "Mức tiêu thụ điện và giá tiền") return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, width, height);

      const chartData = top3Devices.map((d) => ({
        name: d.name,
        value: ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000,
      }));

      if (chartData.length === 0) {
        ctx.fillStyle = "#64748b";
        ctx.font = "16px Arial";
        ctx.fillText("Chưa có dữ liệu để hiển thị biểu đồ.", 20, 50);
        return;
      }

      const maxValue = Math.max(...chartData.map((item) => item.value), 1);

      const paddingLeft = 50;
      const paddingBottom = 50;
      const paddingTop = 30;
      const chartHeight = height - paddingTop - paddingBottom;
      const chartWidth = width - paddingLeft - 20;
      const barGap = 30;
      const barWidth = Math.min(80, (chartWidth - barGap * (chartData.length - 1)) / chartData.length);

      ctx.beginPath();
      ctx.moveTo(paddingLeft, paddingTop);
      ctx.lineTo(paddingLeft, height - paddingBottom);
      ctx.lineTo(width - 10, height - paddingBottom);
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2;
      ctx.stroke();

      const steps = 4;
      ctx.font = "12px Arial";
      ctx.fillStyle = "#64748b";

      for (let i = 0; i <= steps; i++) {
        const y = paddingTop + (chartHeight / steps) * i;
        const value = maxValue - (maxValue / steps) * i;

        ctx.beginPath();
        ctx.moveTo(paddingLeft, y);
        ctx.lineTo(width - 10, y);
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillText(value.toFixed(1), 8, y + 4);
      }

      chartData.forEach((item, index) => {
        const x = paddingLeft + index * (barWidth + barGap) + 20;
        const barHeight = (item.value / maxValue) * chartHeight;
        const y = height - paddingBottom - barHeight;

        ctx.fillStyle = "#2563eb";
        ctx.fillRect(x, y, barWidth, barHeight);

        ctx.strokeStyle = "#1d4ed8";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, barWidth, barHeight);

        ctx.fillStyle = "#1e3a8a";
        ctx.font = "12px Arial";
        ctx.fillText(item.value.toFixed(2), x, y - 8);

        ctx.fillStyle = "#0f172a";
        const shortName = item.name.length > 10 ? item.name.slice(0, 10) + "…" : item.name;
        ctx.fillText(shortName, x, height - paddingBottom + 20);
      });
    }, 120);

    return () => clearTimeout(timer);
  }, [top3Devices, activeTab]);

  async function handleEmailAuth() {
    try {
      if (!email || !passwordLogin) {
        alert("Vui lòng nhập email và mật khẩu.");
        return;
      }

      if (authMode === "register") {
        const cred = await createUserWithEmailAndPassword(auth, email, passwordLogin);

        const forceAdmin =
          cred.user.email?.toLowerCase() ===
          (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").toLowerCase();

        await ensureUserProfile({
          uid: cred.user.uid,
          email: cred.user.email,
          displayName: cred.user.displayName,
          forceAdmin,
        });

        alert("Đăng ký thành công.");
      } else {
        await signInWithEmailAndPassword(auth, email, passwordLogin);
        alert("Đăng nhập thành công.");
      }
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Không thể xác thực tài khoản.");
    }
  }

  async function handleGoogleLogin() {
    try {
      const result = await signInWithPopup(auth, googleProvider);

      const forceAdmin =
        result.user.email?.toLowerCase() ===
        (process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").toLowerCase();

      await ensureUserProfile({
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
        forceAdmin,
      });
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Không thể đăng nhập Google.");
    }
  }

  async function handleLogout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error(error);
    }
  }

  async function generateSuggestions() {
    if (devices.length === 0) {
      setAiResult("Vui lòng thêm thiết bị để hệ thống phân tích.");
      return;
    }

    try {
      setAiLoading(true);
      setAiResult("AI đang phân tích dữ liệu...");

      const response = await fetch("/api/groq", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          devices,
          mode: usageType,
          days: safeDays,
          billingMode,
          totalDay,
          totalPeriod,
          totalCost,
          warnings,
          savingGoal: safeGoal,
          top3Devices,
        }),
      });

      const data = await response.json();
      setAiResult(data.text || "Chưa có gợi ý.");
    } catch (error) {
      console.error(error);
      setAiResult("Không thể kết nối AI lúc này.");
    } finally {
      setAiLoading(false);
    }
  }

  function formatMoney(value: number) {
    const safeValue = Number.isFinite(value) ? value : 0;
    return `${safeValue.toLocaleString("vi-VN")} ₫`;
  }

  function formatKwh(value: number) {
    const safeValue = Number.isFinite(value) ? value : 0;
    return `${safeValue.toFixed(2)} kWh`;
  }

  function handlePresetChange(selected: string) {
    setPreset(selected);
    setName(selected);
    setPower(String(presetWatts[selected] || ""));
  }

  function addDevice() {
    const parsedPower = Number(power);
    const parsedQuantity = Number(quantity);
    const parsedHours = Number(hours);

    if (!name.trim()) {
      alert("Vui lòng nhập tên thiết bị.");
      return;
    }

    if (parsedPower <= 0 || parsedQuantity <= 0 || parsedHours <= 0) {
      alert("Vui lòng nhập đúng công suất, số lượng và số giờ sử dụng.");
      return;
    }

    const newDevice: Device = {
      id: Date.now(),
      name: name.trim(),
      power: parsedPower,
      quantity: parsedQuantity,
      hours: parsedHours,
    };

    setDevices((prev) => [...prev, newDevice]);
    setPreset("");
    setName("");
    setPower("");
    setQuantity("");
    setHours("");
    setShowGoToResult(true);
  }

  function removeDevice(id: number) {
    setDevices((prev) => prev.filter((device) => device.id !== id));
  }

  function startEditDevice(device: Device) {
    setEditingId(device.id);
    setEditName(device.name);
    setEditPower(String(device.power));
    setEditQuantity(String(device.quantity));
    setEditHours(String(device.hours));
  }

  function cancelEditDevice() {
    setEditingId(null);
    setEditName("");
    setEditPower("");
    setEditQuantity("");
    setEditHours("");
  }

  function saveEditDevice(id: number) {
    const parsedPower = Number(editPower);
    const parsedQuantity = Number(editQuantity);
    const parsedHours = Number(editHours);

    if (!editName.trim() || parsedPower <= 0 || parsedQuantity <= 0 || parsedHours <= 0) {
      alert("Vui lòng nhập đúng thông tin để cập nhật thiết bị.");
      return;
    }

    setDevices((prev) =>
      prev.map((device) =>
        device.id === id
          ? {
              ...device,
              name: editName.trim(),
              power: parsedPower,
              quantity: parsedQuantity,
              hours: parsedHours,
            }
          : device
      )
    );

    cancelEditDevice();
  }

  function clearAllDevices() {
    if (!confirm("Bạn có chắc muốn xóa toàn bộ thiết bị?")) return;
    setDevices([]);
    setSavedEnergy(0);
    setSavedCost(0);
    setAiResult("Chưa có gợi ý.");
    setShowGoToResult(false);
    cancelEditDevice();
  }

  function simulateSaving(type: "reduce1hour" | "reduceLight" | "led") {
    if (devices.length === 0) {
      alert("Vui lòng thêm thiết bị trước khi mô phỏng tiết kiệm.");
      return;
    }

    let savedPerDay = 0;

    if (type === "reduce1hour") {
      devices.forEach((d) => {
        savedPerDay += ((d.power || 0) * (d.quantity || 0) * 1) / 1000;
      });
    }

    if (type === "reduceLight") {
      devices.forEach((d) => {
        if (d.name.toLowerCase().includes("đèn")) {
          const reducedQuantity = Math.max(1, Math.floor(d.quantity / 2));
          savedPerDay += ((d.power || 0) * reducedQuantity * (d.hours || 0)) / 1000;
        }
      });
    }

    if (type === "led") {
      devices.forEach((d) => {
        if (d.name.toLowerCase().includes("đèn")) {
          const oldEnergy = ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000;
          const newEnergy =
            (((d.power || 0) / 2) * (d.quantity || 0) * (d.hours || 0)) / 1000;
          savedPerDay += oldEnergy - newEnergy;
        }
      });
    }

    const periodEnergy = savedPerDay * safeDays;
    const periodCost =
      usageType === "Doanh nghiệp / Công ty"
        ? periodEnergy * safePrice
        : billingMode === "Biểu giá EVN"
        ? calculateEVNCost(periodEnergy).total
        : periodEnergy * safePrice;

    setSavedEnergy(periodEnergy);
    setSavedCost(periodCost);
  }

  function downloadReport() {
    const lines: string[] = [];
    lines.push("BAO CAO TOM TAT ECOWATT");
    lines.push("======================");
    lines.push(`Loai su dung: ${usageType}`);
    lines.push(`Che do tinh tien: ${billingMode}`);
    lines.push(`Tong dien nang/ngay: ${totalDay.toFixed(2)} kWh`);
    lines.push(`Tong dien nang trong ${safeDays} ngay: ${totalPeriod.toFixed(2)} kWh`);
    lines.push(`Chi phi dien trong ${safeDays} ngay: ${formatMoney(totalCost)}`);
    lines.push(`Muc tieu tiet kiem: ${formatMoney(safeGoal)}`);
    lines.push(`Cac canh bao: ${warnings.join(" | ")}`);
    lines.push(`Diem xanh: ${greenScore}/100 - ${greenBadge}`);
    lines.push("");

    lines.push("Danh sach thiet bi:");
    devices.forEach((d, index) => {
      const energy = ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000;
      lines.push(
        `${index + 1}. ${d.name} - ${d.power}W - So luong: ${d.quantity} - Gio/ngay: ${d.hours} - Dien nang/ngay: ${energy.toFixed(2)} kWh`
      );
    });

    if (priorityActions.length > 0) {
      lines.push("");
      lines.push("Bang hanh dong uu tien:");
      priorityActions.forEach((action, index) => {
        lines.push(
          `${index + 1}. ${action.title} | ${action.note} | Tiet kiem uoc tinh: ${formatMoney(
            action.saving
          )}`
        );
      });
    }

    const blob = new Blob([lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bao-cao-ecowatt.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="rounded-3xl border border-white/10 bg-white/5 px-8 py-6 text-white shadow-2xl backdrop-blur-xl">
          <p className="font-semibold">Đang tải dữ liệu tài khoản...</p>
        </div>
      </main>
    );
  }

  if (!isLoggedIn) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#7c3aed_0%,#312e81_30%,#111827_70%,#0f172a_100%)] text-white">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-fuchsia-500/20 blur-3xl animate-pulse" />
          <div className="absolute right-10 top-20 h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl animate-pulse" />
          <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl animate-pulse" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl items-center justify-center px-4 py-8">
          <div className="grid w-full max-w-6xl overflow-hidden rounded-[32px] border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl md:grid-cols-[420px_1fr]">
            <div className="relative border-r border-white/10 bg-black/10 p-8 md:p-10">
              <div className="mb-10 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-fuchsia-500/20 text-2xl shadow-lg shadow-fuchsia-500/20">
                  ⚡
                </div>
                <div>
                  <h1 className="text-lg font-bold tracking-wide">ECOWATT</h1>
                  <p className="text-xs text-white/60">Track Your Energy</p>
                </div>
              </div>

              <div className="mb-8 flex justify-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10 text-3xl shadow-lg shadow-cyan-400/10">
                  👥
                </div>
              </div>

              <div className="mb-6 flex gap-2 rounded-2xl bg-white/5 p-1">
                <button
                  onClick={() => setAuthMode("login")}
                  className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                    authMode === "login"
                      ? "bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/30"
                      : "text-white/70 hover:bg-white/10"
                  }`}
                >
                  Đăng nhập
                </button>
                <button
                  onClick={() => setAuthMode("register")}
                  className={`flex-1 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                    authMode === "register"
                      ? "bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/30"
                      : "text-white/70 hover:bg-white/10"
                  }`}
                >
                  Đăng ký
                </button>
              </div>

              <div className="space-y-4">
                <input
                  type="email"
                  placeholder="Email / Username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm text-white placeholder:text-white/50 outline-none transition focus:border-fuchsia-400 focus:bg-white/15"
                />

                <input
                  type="password"
                  placeholder="Password"
                  value={passwordLogin}
                  onChange={(e) => setPasswordLogin(e.target.value)}
                  className="w-full rounded-full border border-white/25 bg-white/10 px-5 py-3 text-sm text-white placeholder:text-white/50 outline-none transition focus:border-fuchsia-400 focus:bg-white/15"
                />

                <button
                  onClick={handleEmailAuth}
                  className="mt-2 w-full rounded-full bg-gradient-to-r from-fuchsia-600 via-pink-500 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-700/30 transition hover:scale-[1.02] hover:shadow-fuchsia-500/40"
                >
                  {authMode === "login" ? "Log In" : "Create Account"}
                </button>

                <button
                  onClick={handleGoogleLogin}
                  className="w-full rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Đăng nhập với Google
                </button>
              </div>

              <div className="mt-6 flex items-center justify-between text-xs text-white/60">
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-fuchsia-500" />
                  <span>Remember me</span>
                </label>
                <span className="cursor-pointer hover:text-white">Secure Access</span>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-white/60">
                Tài khoản mới sẽ được tạo với dữ liệu mặc định = 0 và lưu riêng theo từng tài khoản.
              </div>
            </div>

            <div className="relative hidden min-h-[640px] overflow-hidden md:block">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(168,85,247,0.30),transparent_25%),radial-gradient(circle_at_70%_35%,rgba(34,211,238,0.25),transparent_20%),radial-gradient(circle_at_70%_70%,rgba(236,72,153,0.22),transparent_20%)]" />

              <div className="absolute inset-0">
                <div className="absolute left-[-10%] top-[30%] h-24 w-[70%] rotate-[-8deg] rounded-full bg-cyan-400/30 blur-2xl animate-pulse" />
                <div className="absolute left-[25%] top-[45%] h-20 w-[65%] rotate-[10deg] rounded-full bg-fuchsia-500/30 blur-2xl animate-pulse" />
                <div className="absolute left-[10%] top-[58%] h-24 w-[75%] rotate-[-6deg] rounded-full bg-violet-500/30 blur-2xl animate-pulse" />
                <div className="absolute left-[35%] top-[52%] h-16 w-[40%] rotate-[14deg] rounded-full bg-white/30 blur-2xl" />
              </div>

              <div className="relative z-10 flex h-full flex-col justify-between p-10 lg:p-14">
                <div className="flex items-center justify-end gap-8 text-xs font-medium uppercase tracking-[0.2em] text-white/70">
                  <span className="cursor-pointer transition hover:text-white">Home</span>
                  <span className="cursor-pointer transition hover:text-white">Download</span>
                  <span className="cursor-pointer transition hover:text-white">About</span>
                  <span className="cursor-pointer transition hover:text-white">
                    {authMode === "login" ? "Register" : "Login"}
                  </span>
                </div>

                <div className="max-w-xl">
                  <p className="animate-[fadeInUp_0.8s_ease-out] text-6xl font-black leading-none tracking-tight text-white drop-shadow-[0_0_30px_rgba(255,255,255,0.15)] lg:text-7xl">
                    Welcome
                    <br />
                    Back.
                  </p>
                  <p className="mt-6 max-w-md text-base leading-7 text-white/70">
                    Đăng nhập để theo dõi điện năng, lưu dữ liệu cá nhân theo tài khoản và nhận
                    các gợi ý thông minh cho việc tiết kiệm điện.
                  </p>
                </div>

                <div className="text-sm text-white/50">
                  EcoWatt Platform • Smart Energy Dashboard
                </div>
              </div>
            </div>
          </div>
        </div>

        <style jsx global>{`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(24px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="bg-blue-900 text-white shadow-md">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">EcoWatt</h1>
            <p className="text-sm text-blue-100">Track Your Energy, Save Your Money</p>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                    activeTab === tab
                      ? "bg-blue-600 text-white"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{userProfile?.displayName || currentUser?.email}</p>

                  {isAdmin && (
                    <span className="relative inline-flex overflow-hidden rounded-full p-[1px]">
                      <span className="absolute inset-[-1000%] animate-[spin_4s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,#22d3ee_0%,#a855f7_25%,#ec4899_50%,#22d3ee_100%)]" />
                      <span className="relative inline-flex items-center rounded-full bg-slate-900/90 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-lg shadow-fuchsia-500/20">
                        Admin
                      </span>
                    </span>
                  )}
                </div>

                {!isAdmin && <p className="text-blue-100">Quyền: Người dùng</p>}
              </div>

              <button
                onClick={handleLogout}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {activeTab === "Bắt đầu" && (
          <section className="rounded-3xl bg-gradient-to-br from-blue-900 via-blue-600 to-sky-400 p-8 text-white shadow-lg">
            <div className="max-w-3xl">
              <h2 className="text-4xl font-bold leading-tight">
                Track Your Energy, Save Your Money
              </h2>
              <p className="mt-3 text-lg text-blue-50">
                Theo dõi điện năng, tiết kiệm chi phí, hướng tới lối sống xanh bền vững.
              </p>
            </div>

            <div className="mt-8 rounded-2xl bg-white/10 p-6 backdrop-blur-sm">
              <h3 className="text-xl font-semibold">Chọn loại sử dụng điện</h3>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <button
                  onClick={() => {
                    setUsageType("Sinh hoạt / Trường học");
                    setBillingMode("Biểu giá EVN");
                    if (days === "0") setDays("30");
                  }}
                  className={`rounded-2xl px-5 py-4 text-left transition ${
                    usageType === "Sinh hoạt / Trường học"
                      ? "bg-white text-blue-800"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  <p className="font-bold">Sinh hoạt / Trường học</p>
                  <p className="mt-1 text-sm opacity-90">
                    Phù hợp cho gia đình, lớp học, phòng học, khu sinh hoạt.
                  </p>
                </button>

                <button
                  onClick={() => {
                    setUsageType("Doanh nghiệp / Công ty");
                    setBillingMode("Đơn giá cố định");
                    if (days === "0") setDays("30");
                    if (price === "0") setPrice("2800");
                  }}
                  className={`rounded-2xl px-5 py-4 text-left transition ${
                    usageType === "Doanh nghiệp / Công ty"
                      ? "bg-white text-blue-800"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  <p className="font-bold">Doanh nghiệp / Công ty</p>
                  <p className="mt-1 text-sm opacity-90">
                    Phù hợp cho văn phòng, công ty, cơ sở kinh doanh, khu làm việc.
                  </p>
                </button>
              </div>

              <p className="mt-4 text-blue-50">Loại hiện tại: {usageType}</p>

              <div className="mt-6">
                <button
                  onClick={() => setActiveTab("Nhập thiết bị")}
                  className="w-full rounded-3xl bg-white px-6 py-5 text-lg font-bold text-blue-700 transition hover:bg-blue-50 md:w-auto"
                >
                  Bắt đầu tính
                </button>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Nhập thiết bị" && (
          <section className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Nhập thông tin thiết bị</h2>
              <p className="mt-2 text-slate-600">
                Nếu thiết bị không có trong danh sách mẫu, bạn có thể tự nhập tên và công suất.
              </p>

              <div className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
                Loại sử dụng hiện tại: <span className="font-bold">{usageType}</span>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Chọn thiết bị mẫu
                  </label>
                  <select
                    value={preset}
                    onChange={(e) => handlePresetChange(e.target.value)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
                  >
                    <option value="">-- Chọn thiết bị --</option>
                    {Object.keys(presetWatts).map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Tên thiết bị
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ví dụ: Máy bơm nước"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Công suất (W)
                  </label>
                  <input
                    type="number"
                    value={power}
                    onChange={(e) => setPower(e.target.value)}
                    placeholder="Ví dụ: 500"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Số lượng
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Ví dụ: 2"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Số giờ sử dụng/ngày
                  </label>
                  <input
                    type="number"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="Ví dụ: 3"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Số ngày sử dụng
                  </label>
                  <input
                    type="number"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="Ví dụ: 22 hoặc 30"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>

                {usageType === "Sinh hoạt / Trường học" && (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      Chế độ tính tiền điện
                    </label>
                    <select
                      value={billingMode}
                      onChange={(e) => setBillingMode(e.target.value as BillingMode)}
                      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
                    >
                      <option value="Biểu giá EVN">Biểu giá EVN</option>
                      <option value="Đơn giá cố định">Đơn giá cố định</option>
                    </select>
                  </div>
                )}

                {(usageType === "Doanh nghiệp / Công ty" || billingMode === "Đơn giá cố định") && (
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700">
                      {usageType === "Doanh nghiệp / Công ty"
                        ? "Đơn giá điện doanh nghiệp (VNĐ/kWh)"
                        : "Đơn giá điện (VNĐ/kWh)"}
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={usageType === "Doanh nghiệp / Công ty" ? "Ví dụ: 2800" : "Ví dụ: 3000"}
                      className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Mục tiêu tiết kiệm (VNĐ)
                  </label>
                  <input
                    type="number"
                    value={savingGoal}
                    onChange={(e) => setSavingGoal(e.target.value)}
                    placeholder="Ví dụ: 50000"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={addDevice}
                  className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
                >
                  Thêm thiết bị
                </button>
                <button
                  onClick={clearAllDevices}
                  className="rounded-2xl border border-blue-600 bg-white px-5 py-3 font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  Xóa toàn bộ
                </button>
              </div>

              {showGoToResult && (
                <div className="mt-5 rounded-2xl border border-green-200 bg-green-50 p-4">
                  <p className="text-sm text-green-800">
                    Đã thêm thiết bị thành công. Bạn có thể xem ngay mức tiêu thụ điện và giá tiền.
                  </p>
                  <button
                    onClick={() => setActiveTab("Mức tiêu thụ điện và giá tiền")}
                    className="mt-3 rounded-2xl bg-green-600 px-4 py-2 font-semibold text-white transition hover:bg-green-700"
                  >
                    Đi đến trang mức tiêu thụ điện và giá tiền
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Danh sách thiết bị</h2>
                  <p className="mt-1 text-slate-500">Tìm kiếm và sắp xếp để dễ theo dõi hơn.</p>
                </div>

                <div className="grid w-full grid-cols-1 gap-3 md:max-w-xl md:grid-cols-2">
                  <input
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="Tìm thiết bị..."
                    className="w-full rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                  />

                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as SortMode)}
                    className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
                  >
                    <option value="Tên A-Z">Sắp xếp: Tên A-Z</option>
                    <option value="Điện năng giảm dần">Sắp xếp: Điện năng giảm dần</option>
                    <option value="Công suất giảm dần">Sắp xếp: Công suất giảm dần</option>
                  </select>
                </div>
              </div>

              {filteredAndSortedDevices.length === 0 ? (
                <p className="mt-4 text-slate-500">Chưa có thiết bị phù hợp.</p>
              ) : (
                <div className="mt-4 grid gap-4">
                  {filteredAndSortedDevices.map((device) => {
                    const energyPerDay =
                      ((device.power || 0) * (device.quantity || 0) * (device.hours || 0)) / 1000;

                    const isEditing = editingId === device.id;

                    return (
                      <div
                        key={device.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        {isEditing ? (
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                              placeholder="Tên thiết bị"
                            />
                            <input
                              type="number"
                              value={editPower}
                              onChange={(e) => setEditPower(e.target.value)}
                              className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                              placeholder="Công suất"
                            />
                            <input
                              type="number"
                              value={editQuantity}
                              onChange={(e) => setEditQuantity(e.target.value)}
                              className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                              placeholder="Số lượng"
                            />
                            <input
                              type="number"
                              value={editHours}
                              onChange={(e) => setEditHours(e.target.value)}
                              className="rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                              placeholder="Giờ sử dụng/ngày"
                            />

                            <div className="flex flex-wrap gap-3 md:col-span-2">
                              <button
                                onClick={() => saveEditDevice(device.id)}
                                className="rounded-xl bg-green-600 px-4 py-2 text-white transition hover:bg-green-700"
                              >
                                Lưu chỉnh sửa
                              </button>
                              <button
                                onClick={cancelEditDevice}
                                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-slate-700 transition hover:bg-slate-100"
                              >
                                Hủy
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="space-y-1 text-sm text-slate-700">
                              <p className="text-lg font-bold text-slate-900">{device.name}</p>
                              <p>Công suất: {device.power} W</p>
                              <p>Số lượng: {device.quantity}</p>
                              <p>Giờ sử dụng/ngày: {device.hours}</p>
                              <p>Điện năng/ngày: {energyPerDay.toFixed(2)} kWh</p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => startEditDevice(device)}
                                className="rounded-xl bg-amber-500 px-4 py-2 text-white transition hover:bg-amber-600"
                              >
                                Sửa
                              </button>
                              <button
                                onClick={() => removeDevice(device.id)}
                                className="rounded-xl bg-red-500 px-4 py-2 text-white transition hover:bg-red-600"
                              >
                                Xóa
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "Mức tiêu thụ điện và giá tiền" && (
          <section className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-xl font-bold text-slate-900">Tùy chỉnh số ngày tính toán</h2>
              <p className="mt-2 text-slate-600">
                Bạn có thể thay đổi số ngày sử dụng ngay tại đây để xem mức tiêu thụ điện và chi phí tương ứng.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="Ví dụ: 22 hoặc 30"
                  className="w-full max-w-xs rounded-2xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                />

                <button
                  onClick={() => setDays("22")}
                  className="rounded-2xl border border-blue-600 bg-white px-4 py-3 font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  22 ngày
                </button>

                <button
                  onClick={() => setDays("30")}
                  className="rounded-2xl border border-blue-600 bg-white px-4 py-3 font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  30 ngày
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-3xl border-t-4 border-blue-600 bg-white p-6 shadow-md">
                <h3 className="text-sm font-semibold text-slate-500">Tổng điện năng/ngày</h3>
                <p className="mt-3 text-3xl font-bold text-blue-900">{formatKwh(totalDay)}</p>
              </div>

              <div className="rounded-3xl border-t-4 border-blue-600 bg-white p-6 shadow-md">
                <h3 className="text-sm font-semibold text-slate-500">
                  Tổng điện năng trong {safeDays} ngày
                </h3>
                <p className="mt-3 text-3xl font-bold text-blue-900">{formatKwh(totalPeriod)}</p>
              </div>

              <div className="rounded-3xl border-t-4 border-blue-600 bg-white p-6 shadow-md">
                <h3 className="text-sm font-semibold text-slate-500">
                  Chi phí điện trong {safeDays} ngày
                </h3>
                <p className="mt-3 text-3xl font-bold text-blue-900">{formatMoney(totalCost)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  {usageType === "Doanh nghiệp / Công ty"
                    ? `Chi phí điện được tính theo đơn giá điện doanh nghiệp trong ${safeDays} ngày.`
                    : billingMode === "Biểu giá EVN"
                    ? `Chi phí điện được tính theo biểu giá bậc thang EVN trong ${safeDays} ngày.`
                    : `Chi phí điện được tính theo đơn giá điện đã nhập trong ${safeDays} ngày.`}
                </p>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Tiến độ đạt mục tiêu tiết kiệm</h2>
                  <p className="mt-1 text-slate-600">
                    Theo phương án tiết kiệm hiện tại, bạn đang tiến gần mục tiêu đã đặt.
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Mục tiêu: <span className="font-bold">{formatMoney(safeGoal)}</span>
                </div>
              </div>

              <div className="mt-5 h-5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                  style={{ width: `${goalProgress}%` }}
                />
              </div>

              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700 md:flex-row md:items-center md:justify-between">
                <p>
                  Tiết kiệm hiện tại theo mô phỏng:{" "}
                  <span className="font-bold">{formatMoney(savedCost)}</span>
                </p>
                <p>
                  Tiến độ đạt mục tiêu:{" "}
                  <span className="font-bold">{goalProgress.toFixed(0)}%</span>
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-blue-100 bg-blue-50 p-6 shadow-sm">
                <h2 className="text-2xl font-bold text-slate-900">Thiết bị tiêu thụ nhiều điện nhất</h2>
                <p className="mt-3 text-slate-700">
                  {topDevice
                    ? `${topDevice.name} - ${(
                        ((topDevice.power || 0) *
                          (topDevice.quantity || 0) *
                          (topDevice.hours || 0) *
                          safeDays) /
                        1000
                      ).toFixed(2)} kWh trong ${safeDays} ngày`
                    : "Chưa có dữ liệu"}
                </p>
              </div>

              <div className="rounded-3xl border border-green-100 bg-green-50 p-6 shadow-sm">
                <h2 className="text-2xl font-bold text-slate-900">Ước tính phát thải</h2>
                <p className="mt-3 text-slate-700">
                  Lượng phát thải ước tính hiện tại:{" "}
                  <strong>{co2Current.toFixed(2)} kg CO₂ trong {safeDays} ngày</strong>
                </p>
                <p className="mt-2 text-slate-700">
                  Nếu áp dụng phương án tiết kiệm đã chọn:{" "}
                  <strong>giảm khoảng {co2Saved.toFixed(2)} kg CO₂</strong>
                </p>
              </div>
            </div>

            {usageType === "Sinh hoạt / Trường học" && billingMode === "Biểu giá EVN" && (
              <div className="rounded-3xl bg-white p-6 shadow-md">
                <h2 className="text-2xl font-bold text-slate-900">Chi tiết tính tiền điện theo EVN</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Bậc</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Sản lượng</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Đơn giá</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold text-slate-600">Thành tiền</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evnResult.breakdown.map((item, index) => (
                        <tr key={index} className="border-b">
                          <td className="px-4 py-3 text-sm text-slate-700">{item.label}</td>
                          <td className="px-4 py-3 text-sm text-slate-700">{item.kwh.toFixed(2)} kWh</td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {item.price.toLocaleString("vi-VN")} ₫
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {item.cost.toLocaleString("vi-VN")} ₫
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl bg-white p-6 shadow-md">
                <h2 className="text-2xl font-bold text-slate-900">Top 3 thiết bị tiêu tốn điện</h2>
                {top3Devices.length === 0 ? (
                  <p className="mt-3 text-slate-500">Chưa có dữ liệu.</p>
                ) : (
                  <div className="mt-4 grid gap-3">
                    {top3Devices.map((d, index) => {
                      const energyPerDay =
                        ((d.power || 0) * (d.quantity || 0) * (d.hours || 0)) / 1000;
                      return (
                        <div
                          key={d.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <p className="font-semibold text-slate-900">
                            Top {index + 1}: {d.name}
                          </p>
                          <p className="mt-1 text-sm text-slate-700">
                            {energyPerDay.toFixed(2)} kWh/ngày
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-md">
                <h2 className="text-2xl font-bold text-slate-900">Xuất báo cáo nhanh</h2>
                <p className="mt-3 text-slate-600">
                  Tải báo cáo tóm tắt theo đúng số ngày bạn đã chọn.
                </p>
                <button
                  onClick={downloadReport}
                  className="mt-5 rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
                >
                  Tải báo cáo .txt
                </button>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Biểu đồ điện năng của thiết bị tiêu tốn nhiều nhất</h2>
              <p className="mt-2 text-slate-600">
                Biểu đồ dưới đây giúp bạn nhìn nhanh thiết bị nào đang tiêu thụ điện nhiều hơn.
              </p>

              <div className="mt-5 overflow-x-auto">
                <canvas
                  ref={chartRef}
                  width={520}
                  height={320}
                  className="rounded-2xl border border-slate-200 bg-white max-w-full"
                />
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">So sánh trước và sau khi tiết kiệm</h2>
              <p className="mt-2 text-slate-600">
                Chọn nhanh một giải pháp để xem mức tiết kiệm ước tính.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => simulateSaving("reduce1hour")}
                  className="rounded-2xl bg-green-500 px-4 py-3 font-semibold text-white transition hover:bg-green-600"
                >
                  Giảm 1 giờ sử dụng mỗi ngày
                </button>
                <button
                  onClick={() => simulateSaving("reduceLight")}
                  className="rounded-2xl bg-green-500 px-4 py-3 font-semibold text-white transition hover:bg-green-600"
                >
                  Giảm bớt đèn khi đủ sáng
                </button>
                <button
                  onClick={() => simulateSaving("led")}
                  className="rounded-2xl bg-green-500 px-4 py-3 font-semibold text-white transition hover:bg-green-600"
                >
                  Thay bằng đèn LED
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-500">
                    Điện năng tiết kiệm được trong {safeDays} ngày
                  </h3>
                  <p className="mt-3 text-2xl font-bold text-slate-900">
                    {formatKwh(savedEnergy)}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-500">
                    Chi phí tiết kiệm được trong {safeDays} ngày
                  </h3>
                  <p className="mt-3 text-2xl font-bold text-slate-900">
                    {formatMoney(savedCost)}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Gợi ý thông minh" && (
          <section className="space-y-6">
            <div className="rounded-3xl border border-blue-200 bg-blue-50 p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Gợi ý AI để tiết kiệm điện</h2>
              <p className="mt-2 text-slate-600">
                Hệ thống sẽ phân tích dữ liệu thực tế và đưa ra gợi ý phù hợp.
              </p>

              <div className="mt-5">
                <button
                  onClick={generateSuggestions}
                  className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
                >
                  Phân tích gợi ý tiết kiệm điện
                </button>
              </div>

              <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-5 whitespace-pre-line text-slate-700">
                {aiLoading ? "AI đang phân tích dữ liệu..." : aiResult}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Bảng hành động ưu tiên</h2>
              <p className="mt-2 text-slate-600">
                Đây là những việc nên làm trước để giảm chi phí điện nhanh và hiệu quả hơn.
              </p>

              {priorityActions.length === 0 ? (
                <p className="mt-4 text-slate-500">Chưa có đủ dữ liệu để đề xuất hành động ưu tiên.</p>
              ) : (
                <div className="mt-5 grid gap-4">
                  {priorityActions.map((action, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-lg font-bold text-slate-900">
                            Ưu tiên {index + 1}: {action.title}
                          </p>
                          <p className="mt-1 text-sm text-slate-600">{action.note}</p>
                        </div>
                        <div className="rounded-xl bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                          Có thể tiết kiệm ~ {formatMoney(action.saving)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl bg-white p-6 shadow-md">
                <h2 className="text-2xl font-bold text-slate-900">Cảnh báo sử dụng điện</h2>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-slate-700">
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-md">
                <h2 className="text-2xl font-bold text-slate-900">Mẹo tiết kiệm hôm nay</h2>
                <p className="mt-4 text-slate-700">{randomTip}</p>
                <button
                  onClick={() =>
                    setRandomTip(dailyTips[Math.floor(Math.random() * dailyTips.length)])
                  }
                  className="mt-4 rounded-2xl border border-blue-600 bg-white px-4 py-2 font-semibold text-blue-600 transition hover:bg-blue-50"
                >
                  Đổi mẹo khác
                </button>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Điểm xanh của bạn</h2>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-green-100 bg-green-50 p-5">
                  <p className="text-sm font-semibold text-slate-500">Điểm xanh</p>
                  <p className="mt-2 text-4xl font-black text-green-700">{greenScore}/100</p>
                </div>

                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5">
                  <p className="text-sm font-semibold text-slate-500">Huy hiệu</p>
                  <p className="mt-2 text-2xl font-bold text-blue-800">{greenBadge}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-md">
              <h2 className="text-2xl font-bold text-slate-900">Thông tin nổi bật</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-500">
                    Thiết bị tiêu thụ nhiều điện nhất
                  </h3>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {topDevice ? topDevice.name : "Chưa có dữ liệu"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-500">Mục tiêu tiết kiệm</h3>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {safeGoal > 0 ? `${safeGoal.toLocaleString("vi-VN")} ₫` : "Chưa đặt"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="text-sm font-semibold text-slate-500">
                    Chi phí điện trong {safeDays} ngày
                  </h3>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {formatMoney(totalCost)}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <div className="pointer-events-none fixed bottom-3 right-4 select-none text-xs text-slate-400 opacity-70">
        Dev: Anh Minh
      </div>
    </main>
  );
}