let products = [];
let scanHistory = [];
let scanner = null;

// Prevents the camera's continuous decode loop from re-triggering the
// same barcode dozens of times per second.
let lastScan = { code: null, time: 0 };
const SCAN_COOLDOWN_MS = 2500;

function loadData() {
    try {
        products = JSON.parse(localStorage.getItem("barcode_products")) || [];
        scanHistory = JSON.parse(localStorage.getItem("barcode_history")) || [];
    } catch (error) {
        products = [];
        scanHistory = [];
        console.error("Ma'lumotlarni yuklashda xato:", error);
    }
}

function saveData() {
    try {
        localStorage.setItem("barcode_products", JSON.stringify(products));
        localStorage.setItem("barcode_history", JSON.stringify(scanHistory));
    } catch (error) {
        console.error("Ma'lumotlarni saqlashda xato:", error);
    }
}

function escapeHTML(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function money(value) {
    return Number(value || 0).toLocaleString("uz-UZ") + " so'm";
}

// Non-blocking notification. Replaces alert() in the scan flow so the
// camera loop never freezes waiting for the user to dismiss a dialog.
function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");

    if (!container) {
        // Fallback for any place that hasn't got the container yet.
        console.log(message);
        return;
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add("show"));

    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 300);
    }, 3200);
}

function saveProduct() {
    const barcodeInputEl = document.getElementById("productBarcode");
    const nameInputEl = document.getElementById("productName");
    const priceInputEl = document.getElementById("productPrice");
    const quantityInputEl = document.getElementById("productQuantity");
    const categoryInputEl = document.getElementById("productCategory");
    const idInputEl = document.getElementById("productId");

    const barcode = barcodeInputEl.value.trim();
    const name = nameInputEl.value.trim();
    const price = Number(priceInputEl.value);
    const quantity = Number(quantityInputEl.value);
    const category = categoryInputEl.value;
    const id = idInputEl.value;

    if (!barcode) {
        alert("Barcode kiriting!");
        barcodeInputEl.focus();
        return;
    }

    if (!name) {
        alert("Mahsulot nomini kiriting!");
        nameInputEl.focus();
        return;
    }

    if (isNaN(price) || price < 0 || isNaN(quantity) || quantity < 0) {
        alert("Narx va miqdor to'g'ri hamda musbat son bo'lishi kerak!");
        return;
    }

    if (id) {
        const product = products.find(item => String(item.id) === String(id));

        if (!product) {
            alert("Mahsulot topilmadi!");
            return;
        }

        const duplicate = products.find(
            item => item.barcode === barcode && String(item.id) !== String(id)
        );

        if (duplicate) {
            alert("Bu barcode boshqa mahsulotga tegishli!");
            return;
        }

        product.barcode = barcode;
        product.name = name;
        product.price = price;
        product.quantity = quantity;
        product.category = category;
        product.updatedAt = new Date().toISOString();

        showToast("Mahsulot yangilandi!", "success");
    } else {
        const exists = products.some(item => item.barcode === barcode);

        if (exists) {
            alert("Bu barcode allaqachon mavjud!");
            return;
        }

        const newProduct = {
            id: Date.now(),
            barcode,
            name,
            price,
            quantity,
            category,
            scanCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        products.push(newProduct);
        showToast("Mahsulot saqlandi!", "success");
    }

    saveData();
    clearForm();
    renderAll();
}

function clearForm() {
    document.getElementById("productId").value = "";
    document.getElementById("productBarcode").value = "";
    document.getElementById("productName").value = "";
    document.getElementById("productPrice").value = "";
    document.getElementById("productQuantity").value = "";
    document.getElementById("productCategory").value = "Oziq-ovqat";

    const formTitle = document.getElementById("formTitle");

    if (formTitle) {
        formTitle.textContent = "Mahsulot qo‘shish";
    }
}

function editProduct(id) {
    const product = products.find(item => item.id === id);

    if (!product) return;

    document.getElementById("productId").value = product.id;
    document.getElementById("productBarcode").value = product.barcode;
    document.getElementById("productName").value = product.name;
    document.getElementById("productPrice").value = product.price;
    document.getElementById("productQuantity").value = product.quantity;
    document.getElementById("productCategory").value = product.category;

    const formTitle = document.getElementById("formTitle");

    if (formTitle) {
        formTitle.textContent = "Mahsulotni tahrirlash";
    }

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}

function deleteProduct(id) {
    const product = products.find(item => item.id === id);

    if (!product) return;

    if (!confirm(`"${product.name}" mahsulotini o‘chirasizmi?`)) return;

    products = products.filter(item => item.id !== id);

    saveData();
    renderAll();
}

function addHistory(barcode, name) {
    scanHistory.unshift({
        id: Date.now(),
        barcode,
        name,
        time: new Date().toLocaleString("uz-UZ")
    });

    if (scanHistory.length > 500) {
        scanHistory = scanHistory.slice(0, 500);
    }

    saveData();
    renderHistory();
    updateStats();
}

// Called for every decoded barcode, whether typed manually or read by the
// camera. Existing products just get a scan logged; a barcode that isn't
// in the catalogue yet is now created and saved automatically instead of
// waiting for the user to fill in the form and press "Saqlash".
function processScan(code, options = {}) {
    code = String(code).trim();

    if (!code) return;

    const fromCamera = Boolean(options.fromCamera);
    const now = Date.now();

    if (fromCamera) {
        // Html5Qrcode keeps calling the success callback on every frame it
        // can still decode, so without this guard one physical scan was
        // being logged (and alerted) dozens of times a second.
        if (lastScan.code === code && now - lastScan.time < SCAN_COOLDOWN_MS) {
            return;
        }

        lastScan = { code, time: now };
    }

    const barcodeInput = document.getElementById("barcodeInput");

    if (barcodeInput) barcodeInput.value = code;

    const product = products.find(item => item.barcode === code);

    if (product) {
        product.scanCount = Number(product.scanCount || 0) + 1;
        product.updatedAt = new Date().toISOString();

        addHistory(code, product.name);
        saveData();
        renderAll();

        showToast(
            `✅ ${product.name} — ${money(product.price)} | Qoldiq: ${product.quantity}`,
            "success"
        );
    } else if (fromCamera) {
        // Auto-save: create a placeholder product right away so nothing
        // gets lost mid-scan, then drop it into the form for a quick
        // name/price/quantity correction.
        const newProduct = {
            id: Date.now(),
            barcode: code,
            name: "Noma'lum mahsulot",
            price: 0,
            quantity: 1,
            category: "Boshqa",
            scanCount: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        products.push(newProduct);
        saveData();
        addHistory(code, newProduct.name);
        renderAll();
        editProduct(newProduct.id);

        showToast(
            "🆕 Yangi barcode avtomatik saqlandi. Nomi, narxi va miqdorini to‘ldiring.",
            "info"
        );

        const productName = document.getElementById("productName");

        if (productName) {
            productName.focus();
            productName.select();
        }
    } else {
        // Manual entry path (typed barcode + "Qidirish"): keep the old,
        // explicit behaviour of just prefilling the form for the user.
        const productBarcode = document.getElementById("productBarcode");
        const productName = document.getElementById("productName");

        if (productBarcode) productBarcode.value = code;

        showToast("Bu barcode bazada yo‘q. Mahsulot ma'lumotlarini kiriting.", "info");

        if (productName) {
            productName.focus();
        }
    }
}

let torchOn = false;

async function startScanner() {
    if (scanner) return;

    if (typeof Html5Qrcode === "undefined") {
        alert(
            "Barcode scanner kutubxonasi yuklanmadi.\nInternetni tekshiring."
        );
        return;
    }

    // Reset the debounce state so a code scanned right before stopping
    // (or in a previous session) doesn't block a fresh scan of the same
    // barcode.
    lastScan = { code: null, time: 0 };
    torchOn = false;

    scanner = new Html5Qrcode("reader", { verbose: false });

    try {
        await scanner.start(
            {
                facingMode: "environment"
            },
            {
                fps: 15,
                // A wider, shorter box matches the shape of real 1D
                // barcodes much better than a near-square box, and makes
                // it far easier to line the barcode up.
                qrbox: {
                    width: 320,
                    height: 130
                },
                aspectRatio: 1.7777778,
                // Ask the camera for a bigger, sharper feed. Low
                // resolution / bad auto-exposure is the most common
                // reason a barcode never gets recognised.
                videoConstraints: {
                    facingMode: "environment",
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    advanced: [{ focusMode: "continuous" }]
                },
                // Prefer the phone/browser's native barcode detector when
                // available — it reads real-world 1D barcodes much more
                // reliably than the JS fallback decoder.
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true
                }
            },
            decodedText => {
                processScan(decodedText, { fromCamera: true });
            },
            () => {}
        );

        const video = document.querySelector("#reader video");

        if (video) {
            video.style.transform = "scaleX(-1)";
        }

        setupTorchButton();
    } catch (error) {
        console.error(error);

        scanner = null;

        alert(
            "Kamerani ochib bo‘lmadi.\n\nKameraga ruxsat berilganini tekshiring."
        );
    }
}

async function stopScanner() {
    if (!scanner) return;

    try {
        await scanner.stop();
        scanner.clear();
    } catch (error) {
        console.error(error);
    } finally {
        scanner = null;
        torchOn = false;
        hideTorchButton();
    }
}

// Shows a flashlight toggle when the active camera supports one — dim
// rooms are the most common reason a real barcode won't scan.
function setupTorchButton() {
    const torchBtn = document.getElementById("torchBtn");

    if (!scanner || !torchBtn) return;

    try {
        const capabilities = scanner.getRunningTrackCapabilities
            ? scanner.getRunningTrackCapabilities()
            : {};

        if (capabilities && capabilities.torch) {
            torchBtn.classList.remove("hidden");
            torchBtn.textContent = "🔦 Fonar";
        } else {
            torchBtn.classList.add("hidden");
        }
    } catch (error) {
        console.error(error);
        torchBtn.classList.add("hidden");
    }
}

function hideTorchButton() {
    const torchBtn = document.getElementById("torchBtn");

    if (torchBtn) {
        torchBtn.classList.add("hidden");
        torchBtn.textContent = "🔦 Fonar";
    }
}

async function toggleTorch() {
    if (!scanner) return;

    torchOn = !torchOn;

    try {
        await scanner.applyVideoConstraints({
            advanced: [{ torch: torchOn }]
        });

        const torchBtn = document.getElementById("torchBtn");

        if (torchBtn) {
            torchBtn.textContent = torchOn ? "🔦 Fonarni o‘chirish" : "🔦 Fonar";
        }
    } catch (error) {
        console.error(error);
        torchOn = !torchOn;
        showToast("Bu kamerada fonarni yoqib bo‘lmadi.", "error");
    }
}

// Manual "Qidirish" search. Accepts either an exact barcode (treated as
// a real scan — logged to history) or free text matched against product
// name / barcode (filters the catalogue below, like the live search box
// does), so the user isn't limited to typing exact barcodes here.
function searchBarcode() {
    const barcodeInput = document.getElementById("barcodeInput");
    const query = barcodeInput ? barcodeInput.value.trim() : "";

    if (!query) {
        alert("Barcode yoki mahsulot nomini kiriting!");
        return;
    }

    const exactMatch = products.find(item => item.barcode === query);

    if (exactMatch) {
        addHistory(query, exactMatch.name);

        const searchInput = document.getElementById("search");

        if (searchInput) {
            searchInput.value = exactMatch.name;
        }

        renderProducts();

        showToast(
            `✅ ${exactMatch.name} — ${money(exactMatch.price)} | Qoldiq: ${exactMatch.quantity}`,
            "success"
        );

        scrollToProductsCard();
        return;
    }

    const lowerQuery = query.toLowerCase();
    const nameMatches = products.filter(
        item =>
            item.name.toLowerCase().includes(lowerQuery) ||
            item.barcode.toLowerCase().includes(lowerQuery)
    );

    if (nameMatches.length > 0) {
        const searchInput = document.getElementById("search");

        if (searchInput) {
            searchInput.value = query;
        }

        renderProducts();

        showToast(`🔎 ${nameMatches.length} ta mahsulot topildi.`, "info");
        scrollToProductsCard();
        return;
    }

    const productBarcode = document.getElementById("productBarcode");
    const productName = document.getElementById("productName");

    if (productBarcode) {
        productBarcode.value = query;
    }

    if (productName) {
        productName.focus();
    }

    showToast("Hech narsa topilmadi. Yangi mahsulot sifatida qo‘shishingiz mumkin.", "info");
}

function scrollToProductsCard() {
    const productsCard = document.querySelector(".products-card");

    if (productsCard) {
        productsCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function renderProducts() {
    const table = document.getElementById("productTable");
    const searchInput = document.getElementById("search");

    if (!table) return;

    const text = searchInput
        ? searchInput.value.toLowerCase().trim()
        : "";

    const filtered = products.filter(product => {
        return (
            product.name.toLowerCase().includes(text) ||
            product.barcode.toLowerCase().includes(text) ||
            product.category.toLowerCase().includes(text)
        );
    });

    table.innerHTML = "";

    if (filtered.length === 0) {
        table.innerHTML =
            `<tr><td colspan="7" style="text-align:center">Mahsulot topilmadi</td></tr>`;

        return;
    }

    filtered.forEach(product => {
        const row = document.createElement("tr");
        const lowStock = Number(product.quantity) <= 5;

        row.innerHTML = `
            <td>${escapeHTML(product.barcode)}</td>
            <td>${escapeHTML(product.name)}</td>
            <td>${money(product.price)}</td>
            <td class="${lowStock ? "low-stock" : ""}">
                ${product.quantity}${lowStock ? " ⚠️" : ""}
            </td>
            <td>${escapeHTML(product.category)}</td>
            <td>${product.scanCount || 0}</td>
            <td>
                <div class="action-buttons">
                    <button class="edit" data-action="edit" data-id="${product.id}">✏️</button>
                    <button class="delete" data-action="delete" data-id="${product.id}">🗑️</button>
                </div>
            </td>
        `;

        table.appendChild(row);
    });
}

function renderHistory() {
    const table = document.getElementById("historyTable");

    if (!table) return;

    table.innerHTML = "";

    if (scanHistory.length === 0) {
        table.innerHTML =
            `<tr><td colspan="3" style="text-align:center">Hali scan tarixi yo‘q</td></tr>`;

        return;
    }

    scanHistory.forEach(item => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>${escapeHTML(item.time)}</td>
            <td>${escapeHTML(item.barcode)}</td>
            <td>${escapeHTML(item.name)}</td>
        `;

        table.appendChild(row);
    });
}

function updateStats() {
    const totalProducts = products.length;

    const totalQuantity = products.reduce(
        (sum, p) => sum + Number(p.quantity || 0),
        0
    );

    const totalValue = products.reduce(
        (sum, p) =>
            sum +
            Number(p.price || 0) *
            Number(p.quantity || 0),
        0
    );

    const elTotalProducts =
        document.getElementById("totalProducts");

    const elTotalQuantity =
        document.getElementById("totalQuantity");

    const elTotalValue =
        document.getElementById("totalValue");

    const elTotalScans =
        document.getElementById("totalScans");

    if (elTotalProducts) {
        elTotalProducts.textContent = totalProducts;
    }

    if (elTotalQuantity) {
        elTotalQuantity.textContent = totalQuantity;
    }

    if (elTotalValue) {
        elTotalValue.textContent = money(totalValue);
    }

    if (elTotalScans) {
        elTotalScans.textContent = scanHistory.length;
    }
}

function renderAll() {
    renderProducts();
    renderHistory();
    updateStats();
}

function exportCSV() {
    if (products.length === 0) {
        alert("Eksport qilish uchun mahsulot yo‘q!");
        return;
    }

    let csv =
        "Barcode,Nom,Narx,Miqdor,Kategoriya,Scan soni\n";

    products.forEach(product => {
        csv +=
            `"${String(product.barcode).replaceAll('"', '""')}",` +
            `"${String(product.name).replaceAll('"', '""')}",` +
            `"${product.price}",` +
            `"${product.quantity}",` +
            `"${String(product.category).replaceAll('"', '""')}",` +
            `"${product.scanCount || 0}"\n`;
    });

    const blob = new Blob(
        ["\uFEFF" + csv],
        {
            type: "text/csv;charset=utf-8"
        }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "barcode-products.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
}

function exportExcel() {
    if (products.length === 0) {
        alert("Eksport qilish uchun mahsulot yo‘q!");
        return;
    }

    if (typeof XLSX === "undefined") {
        alert("Excel kutubxonasi yuklanmadi.\nInternetni tekshiring.");
        return;
    }

    const data = products.map((product, index) => ({
        "№": index + 1,
        "Barcode": product.barcode,
        "Mahsulot nomi": product.name,
        "Narxi": Number(product.price || 0),
        "Miqdori": Number(product.quantity || 0),
        "Kategoriya": product.category,
        "Scan soni": Number(product.scanCount || 0),
        "Jami qiymat": Number(product.price || 0) * Number(product.quantity || 0)
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);

    worksheet["!cols"] = [
        { wch: 6 },
        { wch: 20 },
        { wch: 30 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
        { wch: 14 },
        { wch: 18 }
    ];

    worksheet["!autofilter"] = {
        ref: `A1:H${data.length + 1}`
    };

    worksheet["!freeze"] = {
        xSplit: 0,
        ySplit: 1
    };

    for (let i = 0; i < data.length; i++) {
        const row = i + 2;

        if (worksheet[`D${row}`]) worksheet[`D${row}`].z = '#,##0 "so\'m"';
        if (worksheet[`H${row}`]) worksheet[`H${row}`].z = '#,##0 "so\'m"';
    }

    const totalProducts = products.length;

    const totalQuantity = products.reduce(
        (sum, product) =>
            sum + Number(product.quantity || 0),
        0
    );

    const totalValue = products.reduce(
        (sum, product) =>
            sum +
            Number(product.price || 0) *
            Number(product.quantity || 0),
        0
    );

    const totalScans = scanHistory.length;

    const summaryData = [
        ["BARCODE MANAGER"],
        [""],
        ["Ko‘rsatkich", "Qiymat"],
        ["Jami mahsulotlar", totalProducts],
        ["Jami miqdor", totalQuantity],
        ["Jami qiymat", totalValue],
        ["Jami skanlar", totalScans],
        [""],
        ["Eksport sanasi", new Date().toLocaleString("uz-UZ")]
    ];

    const summarySheet =
        XLSX.utils.aoa_to_sheet(summaryData);

    summarySheet["!cols"] = [
        { wch: 25 },
        { wch: 25 }
    ];

    if (summarySheet["B6"]) summarySheet["B6"].z = '#,##0 "so\'m"';

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Mahsulotlar"
    );

    XLSX.utils.book_append_sheet(
        workbook,
        summarySheet,
        "Statistika"
    );

    XLSX.writeFile(
        workbook,
        "Barcode_Manager.xlsx"
    );
}

function clearHistory() {
    if (scanHistory.length === 0) return;

    if (!confirm("Scan tarixini butunlay tozalaysizmi?")) {
        return;
    }

    scanHistory = [];

    saveData();
    renderHistory();
    updateStats();
}

function toggleDarkMode() {
    document.body.classList.toggle("dark");

    const darkButton = document.getElementById("darkBtn");

    if (darkButton) {
        darkButton.querySelector("span").textContent = document.body.classList.contains("dark")
            ? "Light mode"
            : "Dark mode";
    }

    localStorage.setItem(
        "darkMode",
        document.body.classList.contains("dark")
    );
}

document.addEventListener("DOMContentLoaded", () => {
    loadData();

    if (localStorage.getItem("darkMode") === "true") {
        document.body.classList.add("dark");
    }

    const darkButton = document.getElementById("darkBtn");

    if (darkButton && document.body.classList.contains("dark")) {
        darkButton.querySelector("span").textContent = "Light mode";
    }

    const addEv = (id, event, fn) => {
        const el = document.getElementById(id);

        if (el) {
            el.addEventListener(event, fn);
        }
    };

    addEv("saveProduct", "click", saveProduct);
    addEv("clearForm", "click", clearForm);
    addEv("startScanner", "click", startScanner);
    addEv("stopScanner", "click", stopScanner);
    addEv("torchBtn", "click", toggleTorch);
    addEv("searchBarcode", "click", searchBarcode);
    addEv("csvBtn", "click", exportCSV);
    addEv("excelBtn", "click", exportExcel);
    addEv("clearHistory", "click", clearHistory);
    addEv("darkBtn", "click", toggleDarkMode);
    addEv("search", "input", renderProducts);

    const barcodeInput =
        document.getElementById("barcodeInput");

    if (barcodeInput) {
        barcodeInput.addEventListener(
            "keydown",
            event => {
                if (event.key === "Enter") {
                    searchBarcode();
                }
            }
        );
    }

    const productTable =
        document.getElementById("productTable");

    if (productTable) {
        productTable.addEventListener(
            "click",
            event => {
                const button =
                    event.target.closest("button");

                if (!button) return;

                const id =
                    Number(button.dataset.id);

                const action =
                    button.dataset.action;

                if (action === "edit") {
                    editProduct(id);
                }

                if (action === "delete") {
                    deleteProduct(id);
                }
            }
        );
    }

    renderAll();
});