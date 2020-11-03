class VideoMediaPlayer {
    constructor({ manifestJSON, network, videoComponent }) {
        this.manifestJSON = manifestJSON
        this.network = network
        this.videoComponent = videoComponent

        this.videoElement = null
        this.sourceBuffer = null
        this.activeItem = {}
        this.selected = {}
        // evitar rodar como "LIVE"
        this.videoDuration = 0
        this.selections = []
    }

    initializeCodec() {
        this.videoElement = document.getElementById("vid")
        const mediaSourceSupported = !!window.MediaSource

        if (!mediaSourceSupported) {
            alert("Teu browser ou sistema não suporta a MSE!")
            return
        }

        const codecSupported = MediaSource.isTypeSupported(this.manifestJSON.codec)

        if (!codecSupported) {
            alert(`Teu browser ou sistema não suporta o codec: ${this.manifestJSON.codec}!`)
            return
        }

        const mediaSource = new MediaSource()
        this.videoElement.src = URL.createObjectURL(mediaSource)

        mediaSource.addEventListener("sourceopen", this.sourceOpenWrapper(mediaSource))
    }

    sourceOpenWrapper(mediaSource) {
        return async(_) => {
            this.sourceBuffer = mediaSource.addSourceBuffer(this.manifestJSON.codec)
            const selected = this.selected = this.manifestJSON.intro

            mediaSource.duration = this.videoDuration
            await this.fileDownload(selected.url)

            // vai chamar o metodo a cada 200ms
            setInterval(this.waitForQuestions.bind(this), 200)
        }
    }

    waitForQuestions() {
        const currentTime = parseInt(this.videoElement.currentTime)
        const option = this.selected.at === currentTime

        if (!option) return;

        // evita que o modal seja aberto 2x no mesmo segundo
        if (this.activeItem.url === this.selected.url) return;

        this.videoComponent.configureModal(this.selected.options)
        this.activeItem = this.selected
    }

    async currentFileResolution() {
        // vai no servidor, pega o arquivo com a menor resolução possível,
        // calcula o throughput deste arquivo para ele poder baixar os próximos

        const LOWEST_RESOLUTION = 144
        const prepareUrl = {
            // faremos o teste com o arquivo "finalizar", pois ele é o menor arquivo
            url: this.manifestJSON.finalizar.url,
            fileResolution: LOWEST_RESOLUTION,
            fileResolutionTag: this.manifestJSON.fileResolutionTag,
            fileHostTag: this.manifestJSON.fileHostTag
        }

        const url = this.network.parseManifestURL(prepareUrl)

        return this.network.getProperResolution(url)
    }

    async nextChunk(data) {
        // escolher o próximo vídeo

        console.log('nextChunk...')

        const key = data.toLowerCase()

        console.log('key: ', key)

        const selected = this.manifestJSON[key]
        this.selected = {
            // tudo o que nós já tínhamos...
            ...selected,
            // ajustar o tempo que o modal vai aparecer, baseado
            // no tempo corrente
            at: parseInt(this.videoElement.currentTime + selected.at)
        }

        this.manageLag(this.selected)

        // deixa o restante do video rodar enquanto baixa o novo video
        this.videoElement.play()

        // fazer download do servidor sem que o usuário perceba
        await this.fileDownload(selected.url)

    }

    manageLag(selected) {
        if (!!~this.selections.indexOf(selected.url)) {
            selected.at += 5
            return
        }

        this.selections.push(selected.url)
    }

    async fileDownload(url) {
        const fileResolution = await this.currentFileResolution()
        console.log("current resolution: ", fileResolution)
        const prepareUrl = {
            url,
            fileResolution,
            fileResolutionTag: this.manifestJSON.fileResolutionTag,
            hostTag: this.manifestJSON.hostTag
        }

        const finalUrl = this.network.parseManifestURL(prepareUrl)
        this.setVideoPlayerDuration(finalUrl)

        const data = await this.network.fetchFile(finalUrl)

        return this.processBufferSegments(data)
    }

    setVideoPlayerDuration(finalUrl) {
        const bars = finalUrl.split('/')
        const [ name, videoDuration ] = bars[bars.length - 1].split('-')
        this.videoDuration += parseFloat(videoDuration)
    }

    async processBufferSegments(allSegments) {
        const sourceBuffer = this.sourceBuffer
        sourceBuffer.appendBuffer(allSegments)

        return new Promise((resolve, reject) => {
            const updateEnd = (_) => {
                sourceBuffer.removeEventListener("updateend", updateEnd)
                sourceBuffer.timestampOffset = this.videoDuration

                return resolve()
            }

            sourceBuffer.addEventListener("updateend", updateEnd)
            sourceBuffer.addEventListener("error", reject)
        })
    }
}
