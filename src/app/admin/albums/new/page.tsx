import AlbumForm from "../AlbumForm";

export default function NewAlbumPage() {
  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">앨범 등록</h1>
      <AlbumForm
        initialData={{
          slug: "",
          type: "album",
          originalTitle: "",
          originalLanguage: "ja",
          releaseDate: null,
          labelName: null,
          translations: [],
          artistIds: [],
        }}
      />
    </div>
  );
}
