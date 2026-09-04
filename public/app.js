const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const status = document.getElementById("status");
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const testBtn = document.getElementById("testBtn");

const countrySelect = document.getElementById("countrySelect");
const genderSelect = document.getElementById("genderSelect");
const searchCountrySelect = document.getElementById("searchCountrySelect");
const searchGenderSelect = document.getElementById("searchGenderSelect");
const partnerInfo = document.getElementById("partnerInfo");

let localStream;
let peerConnection;
let socket;

const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

const countryNames = {
    NL: "🇳🇱 Нидерланды",
    RU: "🇷🇺 Россия",
    UA: "🇺🇦 Украина",
    DE: "🇩🇪 Германия",
    FR: "🇫🇷 Франция",
    US: "🇺🇸 США",
    GB: "🇬🇧 Великобритания",
    PL: "🇵🇱 Польша",
    KZ: "🇰🇿 Казахстан",
    TR: "🇹🇷 Турция"
};

const genderNames = {
    male: "👨 Мужчина",
    female: "👩 Женщина",
    none: "Пол не указан"
};

async function startCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = localStream;
        status.textContent = "Камера и микрофон включены ✅";
    } catch (error) {
        console.error(error);
        status.textContent = "Не удалось получить доступ к камере/микрофону ❌";
    }
}

function connectSocket() {
    const protocol =
        window.location.protocol === "https:" ? "wss:" : "ws:";

    socket = new WebSocket(
        protocol + "//" + window.location.host
    );

    socket.onopen = () => {
        status.textContent = "Соединение с сервером установлено ✅";
    };

    socket.onerror = () => {
        status.textContent = "Ошибка соединения с сервером ❌";
    };

    socket.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
            status.textContent = "Сервер подключён ✅";
        }

        if (data.type === "waiting") {
            status.textContent = "Ищем собеседника... 🔎";
        }

        if (data.type === "matched") {
            status.textContent = "Собеседник найден! 🎉";

            if (data.partner) {
                const country =
                    countryNames[data.partner.country] ||
                    "🌍 Страна не указана";

                const gender =
                    genderNames[data.partner.gender] ||
                    "Пол не указан";

                partnerInfo.textContent =
                    `${country} · ${gender}`;
            }

            await createPeerConnection();

            if (data.initiator) {
                const offer =
                    await peerConnection.createOffer();

                await peerConnection.setLocalDescription(offer);

                socket.send(JSON.stringify({
                    type: "offer",
                    offer: offer
                }));
            }
        }

        if (data.type === "offer") {
            await createPeerConnection();

            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(data.offer)
            );

            const answer =
                await peerConnection.createAnswer();

            await peerConnection.setLocalDescription(answer);

            socket.send(JSON.stringify({
                type: "answer",
                answer: answer
            }));
        }

        if (data.type === "answer") {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(data.answer)
            );
        }

        if (data.type === "candidate") {
            if (peerConnection) {
                try {
                    await peerConnection.addIceCandidate(
                        new RTCIceCandidate(data.candidate)
                    );
                } catch (error) {
                    console.error(error);
                }
            }
        }

        if (data.type === "partner_left") {
            status.textContent = "Собеседник отключился";

            partnerInfo.textContent =
                "Собеседник ещё не найден";

            remoteVideo.srcObject = null;

            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
        }
    };

    socket.onclose = () => {
        status.textContent =
            "Соединение с сервером закрыто ❌";
    };
}

async function createPeerConnection() {
    if (peerConnection) return;

    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
        status.textContent =
            "🎉 Вы подключены к собеседнику!";
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket) {
            socket.send(JSON.stringify({
                type: "candidate",
                candidate: event.candidate
            }));
        }
    };
}

findBtn.onclick = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        status.textContent =
            "Сервер ещё не подключён ❌";
        return;
    }

    partnerInfo.textContent =
        "Ищем собеседника... 🔎";

    socket.send(JSON.stringify({
        type: "find",
        country: countrySelect.value,
        gender: genderSelect.value,
        searchCountry: searchCountrySelect.value,
        searchGender: searchGenderSelect.value
    }));

    status.textContent =
        "Ищем подходящего собеседника... 🔎";
};

nextBtn.onclick = () => {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteVideo.srcObject = null;

    partnerInfo.textContent =
        "Ищем нового собеседника... 🔎";

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: "next"
        }));
    }

    status.textContent =
        "Ищем нового собеседника... 🔎";
};

testBtn.onclick = () => {
    if (!socket) {
        status.textContent =
            "❌ WebSocket не создан";
        return;
    }

    if (socket.readyState === WebSocket.OPEN) {
        status.textContent =
            "🟢 WebSocket работает! Соединение активно.";
    } else if (socket.readyState === WebSocket.CONNECTING) {
        status.textContent =
            "🟡 WebSocket подключается...";
    } else {
        status.textContent =
            "🔴 WebSocket не подключён.";
    }
};

startCamera();
connectSocket();
