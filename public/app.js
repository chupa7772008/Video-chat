const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const status = document.getElementById("status");
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");

const countrySelect = document.getElementById("countrySelect");
const genderSelect = document.getElementById("genderSelect");
const searchCountrySelect = document.getElementById("searchCountrySelect");
const searchGenderSelect = document.getElementById("searchGenderSelect");
const partnerInfo = document.getElementById("partnerInfo");

const privateBtn = document.getElementById("privateBtn");
const cameraBtn = document.getElementById("cameraBtn");
const micBtn = document.getElementById("micBtn");
const soundBtn = document.getElementById("soundBtn");
const flipBtn = document.getElementById("flipBtn");

let localStream = null;
let peerConnection = null;
let socket = null;

let cameraEnabled = true;
let micEnabled = true;
let soundEnabled = true;

let currentFacingMode = "user";

const config = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
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

function updateControls() {
    if (cameraBtn) {
        cameraBtn.textContent =
            cameraEnabled ? "📹" : "🚫";
    }

    if (micBtn) {
        micBtn.textContent =
            micEnabled ? "🎤" : "🔇";
    }

    if (soundBtn) {
        soundBtn.textContent =
            soundEnabled ? "🔊" : "🔇";
    }

    if (flipBtn) {
        flipBtn.textContent = "🔄";
    }
}

async function startCamera() {
    if (!navigator.mediaDevices) {
        status.textContent = "ОШИБКА: mediaDevices НЕДОСТУПЕН ❌";
        return;
    }
    if (!navigator.mediaDevices.getUserMedia) {
        status.textContent = "ОШИБКА: getUserMedia НЕДОСТУПЕН ❌";
        return;
    }
    status.textContent = "WebView: getUserMedia ЕСТЬ ✅";
    status.textContent = "ЗАПУСК КАМЕРЫ...";
    try {
        localStream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: currentFacingMode
                },
                audio: false
            });

        localVideo.srcObject = localStream;

        const videoTrack =
            localStream.getVideoTracks()[0];

        const audioTrack =
            localStream.getAudioTracks()[0];

        if (videoTrack) {
            videoTrack.enabled = cameraEnabled;
        }

        if (audioTrack) {
            audioTrack.enabled = micEnabled;
        }

        remoteVideo.muted = !soundEnabled;

        updateControls();

        status.textContent =
            "Камера и микрофон включены ✅";

    } catch (error) {
        console.error(
            "Ошибка камеры/микрофона:",
            error
        );

        status.textContent = "Ошибка камеры: " + (error.name || "UNKNOWN") + " — " + (error.message || "нет описания") + " ❌";
    }
}

function connectSocket() {
    const protocol =
        window.location.protocol === "https:"
            ? "wss:"
            : "ws:";

    socket = new WebSocket(
        protocol + "//" + window.location.host
    );

    socket.onopen = () => {
        status.textContent =
            "Соединение с сервером установлено ✅";
    };

    socket.onerror = () => {
        status.textContent =
            "Ошибка соединения с сервером ❌";
    };

    socket.onmessage = async (event) => {
        try {
            const data =
                JSON.parse(event.data);

            if (data.type === "connected") {
                status.textContent =
                    "Сервер подключён ✅";
            }

            if (data.type === "waiting") {
                status.textContent =
                    "Ищем собеседника... 🔎";
            }

            if (data.type === "matched") {
                status.textContent =
                    "Собеседник найден! 🎉";

                if (data.partner) {
                    const country =
                        countryNames[
                            data.partner.country
                        ] ||
                        "🌍 Страна не указана";

                    const gender =
                        genderNames[
                            data.partner.gender
                        ] ||
                        "Пол не указан";

                    partnerInfo.textContent =
                        `${country} · ${gender}`;
                }

                await createPeerConnection();

                if (data.initiator) {
                    const offer =
                        await peerConnection.createOffer();

                    await peerConnection.setLocalDescription(
                        offer
                    );

                    if (
                        socket &&
                        socket.readyState === WebSocket.OPEN
                    ) {
                        socket.send(
                            JSON.stringify({
                                type: "offer",
                                offer: offer
                            })
                        );
                    }
                }
            }

            if (data.type === "offer") {
                await createPeerConnection();

                await peerConnection.setRemoteDescription(
                    new RTCSessionDescription(
                        data.offer
                    )
                );

                const answer =
                    await peerConnection.createAnswer();

                await peerConnection.setLocalDescription(
                    answer
                );

                if (
                    socket &&
                    socket.readyState === WebSocket.OPEN
                ) {
                    socket.send(
                        JSON.stringify({
                            type: "answer",
                            answer: answer
                        })
                    );
                }
            }

            if (data.type === "answer") {
                if (peerConnection) {
                    await peerConnection.setRemoteDescription(
                        new RTCSessionDescription(
                            data.answer
                        )
                    );
                }
            }

            if (data.type === "candidate") {
                if (peerConnection) {
                    try {
                        await peerConnection.addIceCandidate(
                            new RTCIceCandidate(
                                data.candidate
                            )
                        );
                    } catch (error) {
                        console.error(
                            "Ошибка ICE candidate:",
                            error
                        );
                    }
                }
            }

            if (data.type === "partner_left") {
                status.textContent =
                    "Собеседник отключился";

                partnerInfo.textContent =
                    "Собеседник ещё не найден";

                remoteVideo.srcObject = null;

                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                }
            }

        } catch (error) {
            console.error(
                "Ошибка обработки сообщения:",
                error
            );
        }
    };

    socket.onclose = () => {
        status.textContent =
            "Соединение с сервером закрыто ❌";
    };
}

async function renegotiate() {
    if (!peerConnection) {
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        const offer = await peerConnection.createOffer();

        await peerConnection.setLocalDescription(
            offer
        );

        socket.send(
            JSON.stringify({
                type: "offer",
                offer: offer
            })
        );
    } catch (error) {
        console.error(
            "Ошибка renegotiation:",
            error
        );
    }
}

async function createPeerConnection() {
    if (peerConnection) {
        return;
    }

    if (!localStream) {
        status.textContent =
            "Камера ещё не готова ❌";

        return;
    }

    peerConnection =
        new RTCPeerConnection(config);

    localStream
        .getTracks()
        .forEach(track => {
            peerConnection.addTrack(
                track,
                localStream
            );
        });

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject =
            event.streams[0];

        remoteVideo.muted =
            !soundEnabled;

        remoteVideo.play().catch((error) => {
            console.error(
                "Ошибка воспроизведения звука:",
                error
            );
        });

        status.textContent =
            "🎉 Вы подключены к собеседнику!";
    };

    peerConnection.onicecandidate =
        (event) => {
            if (
                event.candidate &&
                socket &&
                socket.readyState === WebSocket.OPEN
            ) {
                socket.send(
                    JSON.stringify({
                        type: "candidate",
                        candidate: event.candidate
                    })
                );
            }
        };

    peerConnection.onconnectionstatechange =
        () => {
            if (!peerConnection) {
                return;
            }

            const state =
                peerConnection.connectionState;

            if (state === "connected") {
                status.textContent =
                    "🎉 Вы подключены к собеседнику!";
            }

            if (state === "disconnected") {
                status.textContent =
                    "Соединение прервано";
            }

            if (state === "failed") {
                status.textContent =
                    "Не удалось установить видеосвязь ❌";
            }
        };
}

findBtn.onclick = () => {
    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        status.textContent =
            "Сервер ещё не подключён ❌";

        return;
    }

    partnerInfo.textContent =
        "Ищем собеседника... 🔎";

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    remoteVideo.srcObject = null;

    socket.send(
        JSON.stringify({
            type: "find",

            country:
                countrySelect.value,

            gender:
                genderSelect.value,

            searchCountry:
                searchCountrySelect.value,

            searchGender:
                searchGenderSelect.value
        })
    );

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

    if (
        socket &&
        socket.readyState === WebSocket.OPEN
    ) {
        socket.send(
            JSON.stringify({
                type: "next"
            })
        );
    }

    status.textContent =
        "Ищем нового собеседника... 🔎";
};

if (privateBtn) {
    privateBtn.onclick = () => {
        alert(
            "🔒 Приватная сессия будет доступна после оплаты."
        );
    };
}

if (cameraBtn) {
    cameraBtn.onclick = () => {
        if (!localStream) {
            return;
        }

        const videoTrack =
            localStream.getVideoTracks()[0];

        if (!videoTrack) {
            return;
        }

        cameraEnabled =
            !cameraEnabled;

        videoTrack.enabled =
            cameraEnabled;

        updateControls();
    };
}

if (micBtn) {
    micBtn.onclick = async () => {
        if (!localStream) {
            status.textContent = "МИКРОФОН: localStream НЕ НАЙДЕН ❌";
            return;
        }

        status.textContent = "МИКРОФОН: localStream найден ✅";

        let audioTrack =
            localStream.getAudioTracks()[0];

        if (!audioTrack) {
            try {
                status.textContent = "ЗАПУСК МИКРОФОНА...";

                const audioStream =
                    await navigator.mediaDevices.getUserMedia({
                        video: false,
                        audio: true
                    });

                audioTrack =
                    audioStream.getAudioTracks()[0];

                if (!audioTrack) {
                    status.textContent = "Микрофон не найден ❌";
                    return;
                }

                localStream.addTrack(audioTrack);

                if (peerConnection) {
                    peerConnection.addTrack(
                        audioTrack,
                        localStream
                    );

                    await renegotiate();
                }

                micEnabled = true;
                audioTrack.enabled = true;

                status.textContent =
                    "Микрофон включен ✅";

                updateControls();

            } catch (error) {
                console.error(
                    "Ошибка микрофона:",
                    error
                );

                status.textContent =
                    "Ошибка микрофона: " +
                    (error.name || "UNKNOWN") +
                    " — " +
                    (error.message || "нет описания") +
                    " ❌";
            }

            return;
        }

        micEnabled =
            !micEnabled;

        audioTrack.enabled =
            micEnabled;

        updateControls();
    };
}

if (soundBtn) {
    soundBtn.onclick = () => {
        soundEnabled =
            !soundEnabled;

        remoteVideo.muted =
            !soundEnabled;

        updateControls();

        if (soundEnabled) {
            remoteVideo.play().catch(() => {});
        }
    };
}

async function flipCamera() {
    if (!localStream) {
        return;
    }

    const newFacingMode =
        currentFacingMode === "user"
            ? "environment"
            : "user";

    try {
        const newStream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: newFacingMode
                },
                audio: false
            });

        const newVideoTrack =
            newStream.getVideoTracks()[0];

        if (!newVideoTrack) {
            throw new Error(
                "Новая камера не найдена"
            );
        }

        const oldVideoTrack =
            localStream.getVideoTracks()[0];

        if (peerConnection) {
            const sender =
                peerConnection
                    .getSenders()
                    .find(
                        item =>
                            item.track &&
                            item.track.kind === "video"
                    );

            if (sender) {
                await sender.replaceTrack(
                    newVideoTrack
                );
            }
        }

        if (oldVideoTrack) {
            localStream.removeTrack(
                oldVideoTrack
            );

            oldVideoTrack.stop();
        }

        localStream.addTrack(
            newVideoTrack
        );

        newVideoTrack.enabled =
            cameraEnabled;

        localVideo.srcObject =
            localStream;

        currentFacingMode =
            newFacingMode;

        updateControls();

        if (currentFacingMode === "user") {
            status.textContent =
                "🤳 Передняя камера";
        } else {
            status.textContent =
                "📷 Задняя камера";
        }

    } catch (error) {
        console.error(
            "Ошибка переключения камеры:",
            error
        );

        status.textContent =
            "Не удалось переключить камеру ❌";
    }
}

if (flipBtn) {
    flipBtn.onclick = async () => {
        await flipCamera();
    };
}

updateControls();

startCamera();
connectSocket();
