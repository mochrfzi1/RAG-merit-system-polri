# def buat_chunk(teks, ukuran=1000, overlap=200):
#     chunks = []

#     awal = 0

#     while awal < len(teks):
#         akhir = awal + ukuran

#         potongan = teks[awal:akhir].strip()

#         if potongan:
#             chunks.append(potongan)

#         awal += ukuran - overlap

#     return chunks


def buat_chunk(teks, ukuran=1000, overlap=200):
    chunks = []
    awal = 0

    while awal < len(teks):
        akhir = min(awal + ukuran, len(teks))

        # Jika bukan akhir teks, cari batas kata
        if akhir < len(teks):
            batas_spasi = teks.rfind(" ", awal, akhir)

            if batas_spasi > awal:
                akhir = batas_spasi

        potongan = teks[awal:akhir].strip()

        if potongan:
            chunks.append(potongan)

        if akhir == len(teks):
            break

        # Tentukan awal chunk berikutnya
        target_awal = max(akhir - overlap, awal + 1)

        # Mundur ke batas kata agar tidak memotong kata
        batas_spasi = teks.rfind(" ", awal, target_awal)

        if batas_spasi > awal:
            awal = batas_spasi + 1
        else:
            awal = target_awal

    return chunks
